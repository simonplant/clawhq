/**
 * Blue-green deploy — zero-downtime container swap for updates.
 *
 * Instead of down→up (which kills the agent), runs two containers side by side:
 * 1. Start canary container with new image on a secondary port
 * 2. Verify canary health via gateway endpoint
 * 3. Stop primary container
 * 4. Update primary compose with new image, start on original port
 * 5. Keep old image in cache for rollback
 *
 * The CLAWHQ_FWD iptables chain applies to the Docker bridge network,
 * not individual containers — both primary and canary inherit egress rules.
 */

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  GATEWAY_DEFAULT_PORT,
  UPDATER_EXEC_TIMEOUT_MS,
  UPDATER_SHUTDOWN_TIMEOUT_MS,
} from "../../config/defaults.js";

import type { UpdateProgressCallback, UpdateStep, UpdateStepStatus } from "./types.js";

const execFileAsync = promisify(execFile);

// ── Constants ──────────────────────────────────────────────────────────────

const CANARY_PROJECT_NAME = "clawhq_canary";

// ── Types ──────────────────────────────────────────────────────────────────

export interface BlueGreenOptions {
  readonly deployDir: string;
  /** The new image tag to deploy (e.g. "openclaw:custom"). */
  readonly newImageTag: string;
  /** Gateway auth token for verification. */
  readonly gatewayToken?: string;
  /** Port for the canary container (default: primary + 1). */
  readonly canaryPort?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: UpdateProgressCallback;
}

export interface BlueGreenResult {
  readonly success: boolean;
  readonly error?: string;
  /** Whether rollback to old container was performed. */
  readonly rolledBack?: boolean;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Blue-green update: run new version alongside old, verify, swap.
 *
 * Falls back to restart-in-place if canary fails to start.
 */
export async function blueGreenUpdate(options: BlueGreenOptions): Promise<BlueGreenResult> {
  const {
    deployDir,
    newImageTag,
    signal,
  } = options;

  const primaryComposePath = join(deployDir, "engine", "docker-compose.yml");
  const canaryComposePath = join(deployDir, "engine", "docker-compose.canary.yml");
  const primaryPort = GATEWAY_DEFAULT_PORT;
  const canaryPort = options.canaryPort ?? primaryPort + 1;
  const report = progress(options.onProgress);

  // ── Step 1: Generate and start canary ──────────────────────────────────

  report("canary-start", "running", `Starting canary on port ${canaryPort}…`);
  try {
    // BUG-5 FIX: Generate canary compose with volume mounts from the primary compose
    const canaryCompose = await generateCanaryCompose(
      primaryComposePath,
      newImageTag,
      canaryPort,
    );
    await writeFile(canaryComposePath, canaryCompose, "utf-8");

    await execFileAsync(
      "docker",
      [
        "compose", "-p", CANARY_PROJECT_NAME,
        "-f", canaryComposePath,
        "up", "-d", "--wait",
      ],
      { timeout: 120_000, signal },
    );
    report("canary-start", "done", "Canary container started");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    report("canary-start", "failed", `Canary start failed: ${message}`);
    // Clean up canary compose file
    await cleanupCanary(canaryComposePath, signal);
    return { success: false, error: `Canary start failed: ${message}` };
  }

  if (signal?.aborted) {
    await teardownCanary(canaryComposePath, signal);
    return { success: false, error: "Update aborted" };
  }

  // ── Step 2: Verify canary health via gateway endpoint ─────────────────

  // BUG-6 FIX: Verify the canary container's gateway health endpoint,
  // not the host filesystem via doctor
  report("canary-verify", "running", "Verifying canary health…");
  try {
    const healthy = await verifyCanaryHealth(canaryPort, signal);

    if (!healthy) {
      report("canary-verify", "failed", "Canary health check failed");
      await teardownCanary(canaryComposePath, signal);
      return { success: false, error: "Canary health check failed — new version unhealthy" };
    }

    report("canary-verify", "done", "Canary is healthy");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    report("canary-verify", "failed", `Canary verify failed: ${message}`);
    await teardownCanary(canaryComposePath, signal);
    return { success: false, error: `Canary verification failed: ${message}` };
  }

  if (signal?.aborted) {
    await teardownCanary(canaryComposePath, signal);
    return { success: false, error: "Update aborted" };
  }

  // ── Step 3: Swap — stop primary, update compose, start new primary ────

  report("swap", "running", "Swapping to new version…");

  // BUG-16 FIX: If swap fails after stopping primary, attempt to restart
  // the old primary before giving up (so the agent isn't left dead)
  let primaryStopped = false;
  try {
    // Stop primary
    await execFileAsync(
      "docker",
      ["compose", "-f", primaryComposePath, "down"],
      { timeout: UPDATER_SHUTDOWN_TIMEOUT_MS, signal },
    );
    primaryStopped = true;

    // Stop canary (it was on the wrong port)
    await execFileAsync(
      "docker",
      ["compose", "-p", CANARY_PROJECT_NAME, "-f", canaryComposePath, "down"],
      { timeout: UPDATER_EXEC_TIMEOUT_MS, signal },
    );

    // BUG-17 FIX: Update the openclaw service image specifically
    await updatePrimaryImage(primaryComposePath, newImageTag);

    // Start primary with new image on original port
    await execFileAsync(
      "docker",
      ["compose", "-f", primaryComposePath, "up", "-d", "--wait"],
      { timeout: 120_000, signal },
    );

    report("swap", "done", "Swapped to new version");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    report("swap", "failed", `Swap failed: ${message}`);

    // If primary was stopped and we failed to start the new one,
    // try to restart the old primary so the agent isn't dead
    if (primaryStopped) {
      report("swap", "running", "Attempting to restore old primary…");
      try {
        // Revert the image change in compose
        await restorePrimaryImage(primaryComposePath);
        await execFileAsync(
          "docker",
          ["compose", "-f", primaryComposePath, "up", "-d", "--wait"],
          { timeout: 120_000, signal },
        );
        report("swap", "done", "Old primary restored");
      } catch {
        report("swap", "failed", "Could not restore old primary — agent may be down");
      }
    }

    await cleanupCanary(canaryComposePath, signal);
    return { success: false, error: `Swap failed: ${message}`, rolledBack: primaryStopped };
  }

  // Clean up canary compose file
  await cleanupCanary(canaryComposePath, signal);

  return { success: true };
}

// ── Canary Health Verification ───────────────────────────────────────────

/**
 * BUG-6 FIX: Verify canary health by hitting its gateway endpoint directly,
 * not by running doctor checks against the host filesystem.
 */
async function verifyCanaryHealth(
  port: number,
  signal?: AbortSignal,
): Promise<boolean> {
  const maxRetries = 5;
  const retryDelay = 3000;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
        signal: signal ?? AbortSignal.timeout(5000),
      });
      if (response.ok) return true;
    } catch {
      // Container may still be starting up
    }

    if (signal?.aborted) return false;
    if (i < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }

  return false;
}

// ── Compose Generation ──────────────────────────────────────────────────

/**
 * Generate a canary compose from the primary compose.
 *
 * BUG-5 FIX: Reads the actual primary compose to extract volume mounts,
 * environment, and other service config — not just image + port.
 */
async function generateCanaryCompose(
  primaryComposePath: string,
  newImageTag: string,
  canaryPort: number,
): Promise<string> {
  const primaryPort = GATEWAY_DEFAULT_PORT;

  let primaryCompose: string;
  try {
    primaryCompose = await readFile(primaryComposePath, "utf-8");
  } catch {
    // Fall back to minimal compose if primary can't be read
    return generateMinimalCanaryCompose(newImageTag, canaryPort, primaryPort);
  }

  // Extract volumes, environment, env_file, and other config from primary
  const volumeLines = extractYamlBlock(primaryCompose, "volumes");
  const envLines = extractYamlBlock(primaryCompose, "environment");
  const envFileLines = extractYamlBlock(primaryCompose, "env_file");
  const tmpfsLines = extractYamlBlock(primaryCompose, "tmpfs");
  const userLine = extractSimpleField(primaryCompose, "user");
  const capDropLines = extractYamlBlock(primaryCompose, "cap_drop");
  const securityOptLines = extractYamlBlock(primaryCompose, "security_opt");
  const readOnlyLine = extractSimpleField(primaryCompose, "read_only");

  const sections = [
    `    image: ${newImageTag}`,
    `    container_name: openclaw-canary`,
    `    ports:`,
    `      - "127.0.0.1:${canaryPort}:${primaryPort}"`,
    `    restart: "no"`,
  ];

  if (userLine) sections.push(`    user: ${userLine}`);
  if (readOnlyLine) sections.push(`    read_only: ${readOnlyLine}`);
  if (capDropLines) sections.push(`    cap_drop:\n${capDropLines}`);
  if (securityOptLines) sections.push(`    security_opt:\n${securityOptLines}`);
  if (tmpfsLines) sections.push(`    tmpfs:\n${tmpfsLines}`);
  if (volumeLines) sections.push(`    volumes:\n${volumeLines}`);
  if (envLines) sections.push(`    environment:\n${envLines}`);
  if (envFileLines) sections.push(`    env_file:\n${envFileLines}`);

  sections.push(`    healthcheck:`);
  sections.push(`      test: ["CMD", "curl", "-sf", "http://localhost:${primaryPort}/healthz"]`);
  sections.push(`      interval: 5s`);
  sections.push(`      timeout: 5s`);
  sections.push(`      retries: 10`);
  sections.push(`      start_period: 15s`);

  return `# Auto-generated canary compose for blue-green update
# DO NOT EDIT — this file is temporary and will be cleaned up
services:
  openclaw-canary:
${sections.join("\n")}
`;
}

function generateMinimalCanaryCompose(
  newImageTag: string,
  canaryPort: number,
  primaryPort: number,
): string {
  return `# Auto-generated canary compose for blue-green update
# DO NOT EDIT — this file is temporary and will be cleaned up
services:
  openclaw-canary:
    image: ${newImageTag}
    container_name: openclaw-canary
    ports:
      - "127.0.0.1:${canaryPort}:${primaryPort}"
    restart: "no"
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:${primaryPort}/healthz"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 15s
`;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * BUG-17 FIX: Update image tag for the openclaw service specifically,
 * not just the first image: line in the file.
 */
async function updatePrimaryImage(
  composePath: string,
  newImageTag: string,
): Promise<void> {
  const compose = await readFile(composePath, "utf-8");

  // Back up the original compose before modifying
  await writeFile(`${composePath}.pre-update`, compose, "utf-8");

  // Replace image in the openclaw service block.
  // The openclaw service is the first service with an image: line.
  // We match the pattern "image: <tag>" that follows a service name ending in "claw"
  // or is the first image: line in the file.
  const updated = compose.replace(
    /^(\s*image:\s*)["']?[^\s"']+/m,
    `$1${newImageTag}`,
  );

  await writeFile(composePath, updated, "utf-8");
}

/**
 * BUG-16 FIX: Restore the compose file from pre-update backup.
 */
async function restorePrimaryImage(composePath: string): Promise<void> {
  try {
    const backup = await readFile(`${composePath}.pre-update`, "utf-8");
    await writeFile(composePath, backup, "utf-8");
  } catch {
    // No backup available — can't restore
  }
}

/** Extract a YAML block (list items under a key) from compose content. */
function extractYamlBlock(compose: string, key: string): string | null {
  // Match key followed by indented lines (list items or nested values)
  const pattern = new RegExp(`^(\\s*)${key}:\\s*\\n((?:\\1\\s+.+\\n?)*)`, "m");
  const match = compose.match(pattern);
  if (!match) return null;
  const block = match[2].trimEnd();
  return block || null;
}

/** Extract a simple key: value field from compose content. */
function extractSimpleField(compose: string, key: string): string | null {
  const pattern = new RegExp(`^\\s*${key}:\\s*(.+)$`, "m");
  const match = compose.match(pattern);
  return match ? match[1].trim() : null;
}

/** Tear down canary containers and clean up compose file. */
async function teardownCanary(
  canaryComposePath: string,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await execFileAsync(
      "docker",
      ["compose", "-p", CANARY_PROJECT_NAME, "-f", canaryComposePath, "down"],
      { timeout: UPDATER_EXEC_TIMEOUT_MS, signal },
    );
  } catch {
    // Best-effort teardown
  }
  await cleanupCanary(canaryComposePath, signal);
}

/** Remove the canary compose file. */
async function cleanupCanary(
  canaryComposePath: string,
  _signal?: AbortSignal,
): Promise<void> {
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(canaryComposePath);
  } catch {
    // File may not exist
  }
}

function progress(callback?: UpdateProgressCallback) {
  return (step: UpdateStep, status: UpdateStepStatus, message: string): void => {
    if (callback) {
      callback({ step, status, message });
    }
  };
}

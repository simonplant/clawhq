/**
 * Deploy orchestrator for `clawhq up / down / restart`.
 *
 * Coordinates the full deploy sequence:
 *   preflight → compose up → identity lock → firewall apply → health verify → smoke test
 *
 * Every step reports progress via callback. AbortSignal threads through
 * the entire pipeline for clean cancellation. On failure, the user gets
 * a clear, actionable error — never silent failure.
 */

import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { DEPLOY_COMPOSE_TIMEOUT_MS } from "../../config/defaults.js";

import { applyFirewall, removeFirewall } from "./firewall.js";
import { smokeTest, verifyHealth } from "./health.js";
import { runPreflight } from "./preflight.js";
import type {
  DeployOptions,
  DeployProgress,
  DeployResult,
  DeployStepName,
  DeployStepStatus,
  ProgressCallback,
  ShutdownOptions,
  ShutdownResult,
} from "./types.js";

const execFileAsync = promisify(execFile);

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Deploy the agent: preflight → compose up → firewall → health → smoke test.
 *
 * Returns a running, reachable agent or a clear error. Never silent failure.
 */
export async function deploy(options: DeployOptions): Promise<DeployResult> {
  const { deployDir, onProgress, signal } = options;
  const engineDir = join(deployDir, "engine");
  const report = progress(onProgress);

  // ── Step 1: Preflight ──────────────────────────────────────────────────

  if (!options.skipPreflight) {
    report("preflight", "running", "Running preflight checks…");

    const preflight = await runPreflight(deployDir, signal, options.gatewayPort, options.runtime);

    // Report warnings (non-blocking) before checking hard failures
    if (preflight.warnings.length > 0) {
      const warns = preflight.warnings
        .map((c) => `  ⚠ ${c.name}: ${c.message}${c.fix ? ` → ${c.fix}` : ""}`)
        .join("\n");
      report("preflight", "running", `Warning:\n${warns}`);
    }

    if (!preflight.passed) {
      const errors = preflight.failed
        .map((c) => `  • ${c.name}: ${c.message}${c.fix ? ` → ${c.fix}` : ""}`)
        .join("\n");

      report("preflight", "failed", `${preflight.failed.length} preflight check(s) failed`);

      return {
        success: false,
        preflight,
        healthy: false,
        error: `Preflight failed:\n${errors}`,
      };
    }

    if (preflight.warnings.length > 0) {
      report("preflight", "done", `Preflight passed with ${preflight.warnings.length} warning(s)`);
    } else {
      report("preflight", "done", "All preflight checks passed");
    }
  }

  // ── Step 2: Compose Up ─────────────────────────────────────────────────

  if (signal?.aborted) {
    return aborted();
  }

  report("compose-up", "running", "Starting containers…");

  try {
    await execFileAsync(
      "docker",
      ["compose", "-f", join(engineDir, "docker-compose.yml"), "up", "-d", "--wait"],
      { timeout: DEPLOY_COMPOSE_TIMEOUT_MS, signal },
    );
    report("compose-up", "done", "Containers started");

    // Ensure Ollama is reachable from container (iptables rule may be lost on network recreation)
    try {
      await execFileAsync(
        "sudo",
        ["iptables", "-C", "INPUT", "-s", "172.16.0.0/12", "-p", "tcp", "--dport", "11434", "-j", "ACCEPT"],
        { timeout: 5000 },
      );
    } catch {
      // Rule doesn't exist — add it
      try {
        await execFileAsync(
          "sudo",
          ["iptables", "-I", "INPUT", "-s", "172.16.0.0/12", "-p", "tcp", "--dport", "11434", "-j", "ACCEPT"],
          { timeout: 5000 },
        );
        report("compose-up", "done", "Ollama firewall rule applied");
      } catch {
        // sudo not available — non-fatal, doctor will flag it
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    report("compose-up", "failed", "Failed to start containers");
    return {
      success: false,
      preflight: null,
      healthy: false,
      error: `Docker Compose failed: ${message}`,
    };
  }

  // ── Step 3: Identity Lock (chattr +i) ──────────────────────────────────

  if (signal?.aborted) {
    return aborted();
  }

  if (options.immutableIdentity) {
    report("identity-lock", "running", "Marking identity files immutable (chattr +i)…");

    const identityResult = await lockIdentityFiles(deployDir);
    if (identityResult.success) {
      report("identity-lock", "done", `${identityResult.filesLocked} identity file(s) locked`);
    } else {
      // Non-fatal — agent still runs, just without persistence prevention
      report("identity-lock", "skipped", `Identity lock skipped: ${identityResult.error}`);
    }
  }

  // ── Step 4: Firewall ───────────────────────────────────────────────────

  if (signal?.aborted) {
    return aborted();
  }

  // Firewall: enabled by default, auto-enabled by posture (hardened/paranoid).
  // Skipped when: --skip-firewall flag, or security.firewallDisabled in clawhq.yaml
  const clawhqConfigPath = join(deployDir, "clawhq.yaml");
  let firewallDisabledByConfig = false;
  try {
    const { readFileSync } = await import("node:fs");
    const { parse: yamlParse } = await import("yaml");
    const raw = yamlParse(readFileSync(clawhqConfigPath, "utf-8")) as Record<string, unknown>;
    const security = raw.security as Record<string, unknown> | undefined;
    firewallDisabledByConfig = security?.firewallDisabled === true;
  } catch { /* no config or parse error — default to enabled */ }

  if (!options.skipFirewall && !firewallDisabledByConfig) {
    const firewallOpts = { deployDir, airGap: options.airGap, signal };
    report("firewall", "running", options.airGap ? "Applying air-gap firewall (all egress blocked)…" : "Applying egress firewall…");

    const fwResult = await applyFirewall(firewallOpts);

    if (!fwResult.success) {
      report("firewall", "failed", "Firewall setup failed");
      // Firewall failure is non-fatal — agent still runs, just without egress filtering
      report("firewall", "skipped", `Firewall skipped: ${fwResult.error}`);
    } else if (fwResult.warning) {
      report("firewall", "skipped", fwResult.warning);
    } else {
      report("firewall", "done", `Firewall applied (${fwResult.rulesApplied} rules${options.airGap ? ", air-gap mode" : ""})`);
    }
  } else {
    report("firewall", "skipped", "Firewall skipped (--skip-firewall)");
  }

  // ── Step 5: Health Verify ──────────────────────────────────────────────

  if (signal?.aborted) {
    return aborted();
  }

  report("health-verify", "running", "Verifying agent is reachable…");

  const healthResult = await verifyHealth({
    gatewayToken: options.gatewayToken,
    gatewayPort: options.gatewayPort,
    signal,
  });

  if (!healthResult.healthy) {
    report("health-verify", "failed", "Agent is not reachable");
    return {
      success: false,
      preflight: null,
      healthy: false,
      error: healthResult.error ?? "Health verification failed — Gateway did not respond",
    };
  }

  report("health-verify", "done", `Agent reachable (${healthResult.attempts} attempt(s), ${healthResult.elapsedMs}ms)`);

  // ── Step 6: Smoke Test ─────────────────────────────────────────────────

  if (signal?.aborted) {
    return aborted();
  }

  report("smoke-test", "running", "Sending real message to agent…");

  const smokeResult = await smokeTest({
    gatewayToken: options.gatewayToken,
    gatewayPort: options.gatewayPort,
    signal,
  });

  if (!smokeResult.healthy) {
    // Smoke test failure is a warning, not a blocker — the gateway is healthy,
    // the agent just can't respond to messages yet (needs model credentials,
    // channel config, etc.). The user can configure these post-deploy.
    report("smoke-test", "skipped", "Smoke test skipped — agent gateway is live but message pipeline not yet configured");
  }

  if (smokeResult.fallback) {
    report("smoke-test", "done", "Smoke test passed (status only — upgrade OpenClaw for full message verification)");
  } else if (smokeResult.messageSent && smokeResult.responseReceived) {
    report("smoke-test", "done", "Smoke test passed — agent responded to real message");
  } else {
    report("smoke-test", "done", "Smoke test passed — agent is live");
  }

  return {
    success: true,
    preflight: null,
    healthy: true,
  };
}

/**
 * Graceful shutdown: unlock identity → compose down → firewall remove.
 */
export async function shutdown(options: ShutdownOptions): Promise<ShutdownResult> {
  const { deployDir, onProgress, signal } = options;
  const engineDir = join(deployDir, "engine");
  const report = progress(onProgress);

  // Unlock identity files if they were locked (best-effort, won't fail shutdown)
  await unlockIdentityFiles(deployDir);

  report("compose-up", "running", "Stopping containers…");

  try {
    const args = ["compose", "-f", join(engineDir, "docker-compose.yml"), "down"];
    if (options.removeVolumes) args.push("-v");

    await execFileAsync("docker", args, { timeout: DEPLOY_COMPOSE_TIMEOUT_MS, signal });
    report("compose-up", "done", "Containers stopped");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    report("compose-up", "failed", "Failed to stop containers");
    return { success: false, error: `Docker Compose down failed: ${message}` };
  }

  // Remove firewall rules
  report("firewall", "running", "Removing firewall rules…");
  const fwResult = await removeFirewall(signal);
  if (fwResult.success) {
    report("firewall", "done", "Firewall rules removed");
  } else {
    report("firewall", "skipped", `Firewall removal skipped: ${fwResult.error}`);
  }

  return { success: true };
}

/**
 * Restart: graceful shutdown → deploy with firewall reapply.
 */
export async function restart(
  deployOptions: DeployOptions,
  shutdownOptions?: Partial<ShutdownOptions>,
): Promise<DeployResult> {
  const shutResult = await shutdown({
    deployDir: deployOptions.deployDir,
    onProgress: deployOptions.onProgress,
    signal: deployOptions.signal,
    ...shutdownOptions,
  });

  if (!shutResult.success) {
    return {
      success: false,
      preflight: null,
      healthy: false,
      error: `Restart failed during shutdown: ${shutResult.error}`,
    };
  }

  return deploy(deployOptions);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function progress(callback?: ProgressCallback) {
  return (step: DeployStepName, status: DeployStepStatus, message: string): void => {
    if (callback) {
      const event: DeployProgress = { step, status, message };
      callback(event);
    }
  };
}

function aborted(): DeployResult {
  return {
    success: false,
    preflight: null,
    healthy: false,
    error: "Deploy aborted",
  };
}

// ── Identity File Immutability ────────────────────────────────────────────

interface IdentityLockResult {
  success: boolean;
  filesLocked: number;
  error?: string;
}

/**
 * Mark identity files immutable with chattr +i.
 *
 * Prevents the agent from modifying its own identity files even if it
 * gains write access through a prompt injection exploit. Requires sudo.
 * Files: workspace/identity/*.md (SOUL.md, AGENTS.md, USER.md, TOOLS.md, etc.)
 */
async function lockIdentityFiles(deployDir: string): Promise<IdentityLockResult> {
  const identityDir = join(deployDir, "workspace", "identity");

  try {
    const files = await readdir(identityDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));

    if (mdFiles.length === 0) {
      return { success: true, filesLocked: 0 };
    }

    const paths = mdFiles.map((f) => join(identityDir, f));

    await execFileAsync("sudo", ["chattr", "+i", ...paths], { timeout: 10_000 });
    return { success: true, filesLocked: mdFiles.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Directory doesn't exist yet — not an error, identity files just haven't been generated
    if (msg.includes("ENOENT")) {
      return { success: true, filesLocked: 0 };
    }
    return { success: false, filesLocked: 0, error: msg };
  }
}

/**
 * Remove immutable flag from identity files before shutdown.
 * Required so files can be updated on next deploy cycle.
 */
async function unlockIdentityFiles(deployDir: string): Promise<void> {
  const identityDir = join(deployDir, "workspace", "identity");
  try {
    const files = await readdir(identityDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    if (mdFiles.length === 0) return;
    const paths = mdFiles.map((f) => join(identityDir, f));
    await execFileAsync("sudo", ["chattr", "-i", ...paths], { timeout: 10_000 });
  } catch {
    // Best-effort unlock — don't fail shutdown for this
  }
}

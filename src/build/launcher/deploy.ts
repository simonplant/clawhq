/**
 * Deploy orchestrator for `clawhq up / down / restart`.
 *
 * Coordinates the full deploy sequence:
 *   preflight → compose up → firewall apply → health verify → smoke test
 *
 * Every step reports progress via callback. AbortSignal threads through
 * the entire pipeline for clean cancellation. On failure, the user gets
 * a clear, actionable error — never silent failure.
 */

import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

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

// ── Constants ────────────────────────────────────────────────────────────────

const COMPOSE_TIMEOUT_MS = 120_000;

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

    const preflight = await runPreflight(deployDir, signal);

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

    report("preflight", "done", "All preflight checks passed");
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
      { timeout: COMPOSE_TIMEOUT_MS, signal },
    );
    report("compose-up", "done", "Containers started");
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

  // ── Step 3: Firewall ───────────────────────────────────────────────────

  if (signal?.aborted) {
    return aborted();
  }

  if (!options.skipFirewall) {
    report("firewall", "running", "Applying egress firewall…");

    const fwResult = await applyFirewall({ deployDir, signal });

    if (!fwResult.success) {
      report("firewall", "failed", "Firewall setup failed");
      // Firewall failure is non-fatal — agent still runs, just without egress filtering
      // Log warning but continue
      report("firewall", "skipped", `Firewall skipped: ${fwResult.error}`);
    } else {
      report("firewall", "done", `Firewall applied (${fwResult.rulesApplied} rules)`);
    }
  } else {
    report("firewall", "skipped", "Firewall skipped (--skip-firewall)");
  }

  // ── Step 4: Health Verify ──────────────────────────────────────────────

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

  // ── Step 5: Smoke Test ─────────────────────────────────────────────────

  if (signal?.aborted) {
    return aborted();
  }

  report("smoke-test", "running", "Running smoke test…");

  const smokeResult = await smokeTest({
    gatewayToken: options.gatewayToken,
    gatewayPort: options.gatewayPort,
    signal,
  });

  if (!smokeResult.healthy) {
    report("smoke-test", "failed", "Smoke test failed");
    return {
      success: false,
      preflight: null,
      healthy: false,
      error: smokeResult.error ?? "Smoke test failed — Gateway responded to health but not to status RPC",
    };
  }

  report("smoke-test", "done", "Smoke test passed — agent is live");

  return {
    success: true,
    preflight: null,
    healthy: true,
  };
}

/**
 * Graceful shutdown: compose down + firewall remove.
 */
export async function shutdown(options: ShutdownOptions): Promise<ShutdownResult> {
  const { deployDir, onProgress, signal } = options;
  const engineDir = join(deployDir, "engine");
  const report = progress(onProgress);

  report("compose-up", "running", "Stopping containers…");

  try {
    const args = ["compose", "-f", join(engineDir, "docker-compose.yml"), "down"];
    if (options.removeVolumes) args.push("-v");

    await execFileAsync("docker", args, { timeout: COMPOSE_TIMEOUT_MS, signal });
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

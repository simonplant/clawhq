/**
 * Deploy orchestration — up, down, restart.
 *
 * `deployUp`:   preflight -> compose up -> firewall apply -> health poll -> report
 * `deployDown`: compose down (graceful, preserves workspace state)
 * `deployRestart`: down -> up with firewall reapply and health re-verify
 */

import { homedir } from "node:os";
import { join } from "node:path";

import { DockerClient } from "../docker/client.js";
import { pollGatewayHealth, HealthPollTimeout as GatewayHealthTimeout } from "../gateway/health.js";
import { apply as applyFirewall, buildConfig as buildFirewallConfig } from "../security/firewall/firewall.js";
import { emitSecretAuditEvent } from "../security/secrets/audit.js";
import { readEnvFile } from "../security/secrets/env.js";
import { runSmokeTest } from "../smoke/index.js";

import { runPreflight } from "./preflight.js";
import type {
  DeployOptions,
  DeployResult,
  RestartResult,
  ShutdownResult,
  StepResult,
} from "./types.js";

async function timedStep(
  name: string,
  fn: () => Promise<{ passed: boolean; message: string }>,
): Promise<StepResult> {
  const start = Date.now();
  try {
    const { passed, message } = await fn();
    return {
      name,
      status: passed ? "done" : "failed",
      message,
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    return {
      name,
      status: "failed",
      message: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

// --- Deploy Up ---

export async function deployUp(opts: DeployOptions = {}): Promise<DeployResult> {
  const steps: StepResult[] = [];
  const composePath = opts.composePath;
  const healthTimeoutMs = opts.healthTimeoutMs ?? 60_000;
  const gatewayHost = opts.gatewayHost ?? "127.0.0.1";
  const gatewayPort = opts.gatewayPort ?? 18789;

  // Step 1: Pre-flight checks
  const preflight = await runPreflight(opts);
  steps.push({
    name: "Pre-flight checks",
    status: preflight.passed ? "done" : "failed",
    message: preflight.passed
      ? `All ${preflight.steps.length} checks passed`
      : `${preflight.steps.filter((s) => s.status === "failed").length} check(s) failed`,
    durationMs: preflight.steps.reduce((sum, s) => sum + s.durationMs, 0),
  });

  if (!preflight.passed) {
    return { success: false, steps };
  }

  // Step 2: Compose up
  const composeClient = composePath
    ? new DockerClient({ cwd: composePath.replace(/\/[^/]+$/, "") })
    : new DockerClient();

  const composeStep = await timedStep("Compose up", async () => {
    await composeClient.up({ detach: true, signal: opts.signal });
    return { passed: true, message: "Containers started" };
  });
  steps.push(composeStep);

  if (composeStep.status === "failed") {
    return { success: false, steps };
  }

  // Step 3: Apply firewall
  const firewallStep = await timedStep("Firewall apply", async () => {
    const fwConfig = await buildFirewallConfig({
      enabledProviders: opts.enabledProviders,
      extraDomains: opts.extraDomains,
      bridgeInterface: opts.bridgeInterface,
    });
    const result = await applyFirewall(fwConfig);
    if (!result.success) {
      return { passed: false, message: `Firewall failed: ${result.message}. Fix: Ensure iptables is available (sudo required)` };
    }
    return { passed: true, message: result.message };
  });
  steps.push(firewallStep);

  // Firewall failure is not fatal — warn but continue
  if (firewallStep.status === "failed") {
    firewallStep.status = "failed";
  }

  // Step 4: Health poll (Gateway at :18789)
  let containerId: string | undefined;
  const healthStep = await timedStep("Health poll", async () => {
    try {
      const health = await pollGatewayHealth({
        host: gatewayHost,
        port: gatewayPort,
        timeoutMs: healthTimeoutMs,
        signal: opts.signal,
      });
      return {
        passed: true,
        message: `Gateway healthy (${health.latencyMs}ms latency)`,
      };
    } catch (err: unknown) {
      if (err instanceof GatewayHealthTimeout) {
        // Try to get container info for diagnostics
        try {
          const containers = await composeClient.ps();
          if (containers.length > 0) {
            containerId = containers[0].id;
            const logs = await composeClient.logs({ tail: 10 });
            return {
              passed: false,
              message: `Gateway health poll timed out after ${err.timeoutMs}ms (last status: ${err.lastStatus}). Recent logs:\n${logs.stdout || logs.stderr}`,
            };
          }
        } catch {
          // Ignore log fetch errors
        }
        return {
          passed: false,
          message: `Gateway health poll timed out after ${err.timeoutMs}ms (last status: ${err.lastStatus}). Fix: Check container logs with \`clawhq logs\``,
        };
      }
      throw err;
    }
  });
  steps.push(healthStep);

  // Get container ID on success
  if (healthStep.status === "done" && !containerId) {
    try {
      const containers = await composeClient.ps();
      if (containers.length > 0) {
        containerId = containers[0].id;
      }
    } catch {
      // Non-fatal
    }
  }

  // Step 4b: Emit deploy-access audit events for all secrets
  if (healthStep.status === "done") {
    const envFilePath = opts.envPath ?? join(opts.openclawHome ?? join(homedir(), ".openclaw"), ".env");
    try {
      const env = await readEnvFile(envFilePath);
      for (const entry of env.entries) {
        if (entry.type === "pair" && entry.key) {
          await emitSecretAuditEvent(envFilePath, "accessed", entry.key);
        }
      }
    } catch {
      // .env may not exist or be empty — non-fatal for deploy
    }
  }

  // Step 5: Smoke test (only if health passed)
  if (healthStep.status === "done" && !opts.skipSmoke) {
    const openclawHome = opts.openclawHome ?? join(homedir(), ".openclaw");
    const configPath = opts.configPath ?? join(openclawHome, "openclaw.json");

    const smokeStep = await timedStep("Smoke test", async () => {
      const result = await runSmokeTest({
        openclawHome,
        configPath,
        gatewayHost,
        gatewayPort,
        gatewayToken: opts.gatewayToken,
        responseTimeoutMs: opts.smokeTimeoutMs,
        signal: opts.signal,
      });

      if (!result.passed) {
        const failures = result.checks
          .filter((c) => c.status === "fail")
          .map((c) => `${c.name}: ${c.message}`)
          .join("; ");
        return { passed: false, message: failures };
      }

      const summary = result.checks
        .map((c) => `${c.name}: ${c.status}`)
        .join(", ");
      return { passed: true, message: summary };
    });
    steps.push(smokeStep);
  }

  const success = steps.every((s) => s.status === "done");
  return { success, steps, containerId };
}

// --- Deploy Down (Graceful Shutdown) ---

export async function deployDown(opts: DeployOptions = {}): Promise<ShutdownResult> {
  const steps: StepResult[] = [];
  const composeClient = opts.composePath
    ? new DockerClient({ cwd: opts.composePath.replace(/\/[^/]+$/, "") })
    : new DockerClient();

  // Step 1: Graceful compose down (preserves volumes/workspace state)
  steps.push(await timedStep("Compose down", async () => {
    await composeClient.down({ signal: opts.signal });
    return { passed: true, message: "Containers stopped gracefully" };
  }));

  const success = steps.every((s) => s.status === "done");
  return { success, steps };
}

// --- Restart (Down -> Up with firewall reapply) ---

export async function deployRestart(opts: DeployOptions = {}): Promise<RestartResult> {
  const steps: StepResult[] = [];
  const healthTimeoutMs = opts.healthTimeoutMs ?? 60_000;
  const gatewayHost = opts.gatewayHost ?? "127.0.0.1";
  const gatewayPort = opts.gatewayPort ?? 18789;

  const composeClient = opts.composePath
    ? new DockerClient({ cwd: opts.composePath.replace(/\/[^/]+$/, "") })
    : new DockerClient();

  // Step 1: Compose down
  steps.push(await timedStep("Compose down", async () => {
    await composeClient.down({ signal: opts.signal });
    return { passed: true, message: "Containers stopped" };
  }));

  if (steps[steps.length - 1].status === "failed") {
    return { success: false, steps };
  }

  // Step 2: Compose up
  steps.push(await timedStep("Compose up", async () => {
    await composeClient.up({ detach: true, signal: opts.signal });
    return { passed: true, message: "Containers restarted" };
  }));

  if (steps[steps.length - 1].status === "failed") {
    return { success: false, steps };
  }

  // Step 3: Reapply firewall (required after compose down recreates network)
  const firewallStep = await timedStep("Firewall reapply", async () => {
    const fwConfig = await buildFirewallConfig({
      enabledProviders: opts.enabledProviders,
      extraDomains: opts.extraDomains,
      bridgeInterface: opts.bridgeInterface,
    });
    const result = await applyFirewall(fwConfig);
    if (!result.success) {
      return { passed: false, message: `Firewall failed: ${result.message}. Fix: Ensure iptables is available (sudo required)` };
    }
    return { passed: true, message: result.message };
  });
  steps.push(firewallStep);

  // Step 4: Health re-verify
  let containerId: string | undefined;
  steps.push(await timedStep("Health re-verify", async () => {
    try {
      const health = await pollGatewayHealth({
        host: gatewayHost,
        port: gatewayPort,
        timeoutMs: healthTimeoutMs,
        signal: opts.signal,
      });
      return { passed: true, message: `Gateway healthy (${health.latencyMs}ms latency)` };
    } catch (err: unknown) {
      if (err instanceof GatewayHealthTimeout) {
        return {
          passed: false,
          message: `Gateway health poll timed out after ${err.timeoutMs}ms. Fix: Check container logs with \`clawhq logs\``,
        };
      }
      throw err;
    }
  }));

  // Get container ID
  try {
    const containers = await composeClient.ps();
    if (containers.length > 0) {
      containerId = containers[0].id;
    }
  } catch {
    // Non-fatal
  }

  const success = steps.every((s) => s.status === "done");
  return { success, steps, containerId };
}

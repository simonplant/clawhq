/**
 * Rollback — restore previous image and restart on update failure.
 *
 * Uses the pre-tagged image (no rebuild needed) for instant recovery:
 * re-tag previous image -> restart -> healthcheck -> firewall reapply.
 */

import type { StepResult } from "../../build/launcher/types.js";
import { DockerClient } from "../../build/docker/client.js";
import { pollGatewayHealth, HealthPollTimeout } from "../../gateway/health.js";
import {
  apply as applyFirewall,
  buildConfig as buildFirewallConfig,
} from "../../secure/firewall/firewall.js";

import type { RollbackOptions, RollbackResult } from "./types.js";

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

/**
 * Rollback to the previous image. No rebuild — uses the pre-tagged image
 * for instant recovery.
 *
 * Sequence: re-tag previous image -> stop -> start -> healthcheck -> firewall
 */
export async function rollback(opts: RollbackOptions): Promise<RollbackResult> {
  const steps: StepResult[] = [];
  const client = new DockerClient();
  const healthTimeoutMs = opts.healthTimeoutMs ?? 60_000;
  const gatewayHost = opts.gatewayHost ?? "127.0.0.1";
  const gatewayPort = opts.gatewayPort ?? 18789;

  const composeClient = opts.composePath
    ? new DockerClient({ cwd: opts.composePath.replace(/\/[^/]+$/, "") })
    : new DockerClient();

  // Step 1: Restore previous image tag
  const restoreStep = await timedStep("Restore image", async () => {
    // The previous image was tagged as <finalTag>-pre-update before the build.
    // Re-tag it back to the original tag name so compose picks it up.
    const originalTag = opts.previousImageTag.replace(/-pre-update$/, "");
    await client.exec(["tag", opts.previousImageTag, originalTag], { signal: opts.signal });
    return { passed: true, message: `Restored ${originalTag} from ${opts.previousImageTag}` };
  });
  steps.push(restoreStep);

  if (restoreStep.status === "failed") {
    return { success: false, steps };
  }

  // Step 2: Stop any running containers
  const stopStep = await timedStep("Stop", async () => {
    try {
      await composeClient.down({ signal: opts.signal });
    } catch {
      // May already be stopped — that's fine
    }
    return { passed: true, message: "Containers stopped" };
  });
  steps.push(stopStep);

  // Step 3: Start with restored image
  const startStep = await timedStep("Start", async () => {
    await composeClient.up({ detach: true, signal: opts.signal });
    return { passed: true, message: "Containers restarted with previous image" };
  });
  steps.push(startStep);

  if (startStep.status === "failed") {
    return { success: false, steps };
  }

  // Step 4: Health check
  const healthStep = await timedStep("Health verify", async () => {
    try {
      const health = await pollGatewayHealth({
        host: gatewayHost,
        port: gatewayPort,
        timeoutMs: healthTimeoutMs,
        signal: opts.signal,
      });
      return { passed: true, message: `Gateway healthy (${health.latencyMs}ms)` };
    } catch (err: unknown) {
      if (err instanceof HealthPollTimeout) {
        return { passed: false, message: `Health poll timed out after ${err.timeoutMs}ms` };
      }
      throw err;
    }
  });
  steps.push(healthStep);

  // Step 5: Reapply firewall
  const firewallStep = await timedStep("Firewall reapply", async () => {
    const fwConfig = await buildFirewallConfig({
      enabledProviders: opts.enabledProviders,
      bridgeInterface: opts.bridgeInterface,
    });
    const result = await applyFirewall(fwConfig);
    if (!result.success) {
      return { passed: false, message: `Firewall: ${result.message}` };
    }
    return { passed: true, message: result.message };
  });
  steps.push(firewallStep);

  const success = steps.every(
    (s) => s.status === "done" || s.name === "Firewall reapply",
  );

  return { success, steps };
}

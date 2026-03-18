/**
 * Recovery actions — perform auto-repair for detected issues.
 *
 * Each action corresponds to a detected issue type and attempts
 * to restore the system to a healthy state.
 */

import { DockerClient } from "../../build/docker/client.js";
import { pollGatewayHealth } from "../../gateway/health.js";
import {
  apply as applyFirewall,
  buildConfig as buildFirewallConfig,
} from "../../secure/firewall/firewall.js";

import type { DetectedIssue, RepairActionResult, RepairContext } from "./types.js";

/**
 * Restart the agent container via docker compose restart,
 * then poll Gateway health to verify recovery.
 */
export async function restartGateway(
  ctx: RepairContext,
): Promise<RepairActionResult> {
  const start = Date.now();

  try {
    const client = new DockerClient();
    await client.composeExec(["restart"], { signal: ctx.signal });

    // Wait for Gateway to come back up
    await pollGatewayHealth({
      host: ctx.gatewayHost,
      port: ctx.gatewayPort,
      timeoutMs: 60_000,
      intervalMs: 2_000,
      signal: ctx.signal,
    });

    return {
      issue: "gateway_down",
      status: "repaired",
      action: "Container restart",
      message: "Container restarted and Gateway is healthy",
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    return {
      issue: "gateway_down",
      status: "failed",
      action: "Container restart",
      message: `Restart failed: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Attempt to reconnect by restarting the container.
 *
 * Network drops are typically resolved by restarting Docker networking,
 * which a compose restart achieves.
 */
export async function reconnectNetwork(
  ctx: RepairContext,
): Promise<RepairActionResult> {
  const start = Date.now();

  try {
    const client = new DockerClient();

    // Restart networking by cycling the container
    await client.composeExec(["restart"], { signal: ctx.signal });

    // Verify connectivity is restored
    await pollGatewayHealth({
      host: ctx.gatewayHost,
      port: ctx.gatewayPort,
      timeoutMs: 30_000,
      intervalMs: 2_000,
      signal: ctx.signal,
    });

    return {
      issue: "network_drop",
      status: "repaired",
      action: "Network reconnect",
      message: "Container restarted and network connectivity restored",
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    return {
      issue: "network_drop",
      status: "failed",
      action: "Network reconnect",
      message: `Reconnect failed: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Reapply the CLAWHQ_FWD firewall chain.
 *
 * Called when the chain is missing (typically after docker compose down
 * recreates the bridge interface).
 */
export async function reapplyFirewall(
  ctx: RepairContext,
): Promise<RepairActionResult> {
  const start = Date.now();

  try {
    const fwConfig = await buildFirewallConfig({
      enabledProviders: ctx.enabledProviders,
      extraDomains: ctx.extraDomains,
      bridgeInterface: ctx.bridgeInterface,
    });

    const result = await applyFirewall(fwConfig);

    if (!result.success) {
      return {
        issue: "firewall_missing",
        status: "failed",
        action: "Firewall reapply",
        message: `Firewall reapply failed: ${result.message}`,
        durationMs: Date.now() - start,
      };
    }

    return {
      issue: "firewall_missing",
      status: "repaired",
      action: "Firewall reapply",
      message: result.message,
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    return {
      issue: "firewall_missing",
      status: "failed",
      action: "Firewall reapply",
      message: `Firewall reapply failed: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Dispatch the appropriate repair action for a detected issue.
 */
export async function repairIssue(
  issue: DetectedIssue,
  ctx: RepairContext,
): Promise<RepairActionResult> {
  switch (issue.type) {
    case "gateway_down":
      return restartGateway(ctx);
    case "network_drop":
      return reconnectNetwork(ctx);
    case "firewall_missing":
      return reapplyFirewall(ctx);
  }
}

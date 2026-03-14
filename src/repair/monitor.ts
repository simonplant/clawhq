/**
 * Health monitors — detect container, network, and firewall issues.
 *
 * Each monitor checks one aspect of the deployment and returns
 * a DetectedIssue if a problem is found, or null if healthy.
 */

import { DockerClient } from "../docker/client.js";
import { checkHealth } from "../gateway/health.js";
import { chainExists } from "../security/firewall/iptables.js";
import { CHAIN_NAME } from "../security/firewall/types.js";

import type { DetectedIssue, RepairContext } from "./types.js";

/**
 * Check if the Gateway container is running and responsive.
 *
 * Detects: container not running, Gateway healthz not responding.
 */
export async function checkGateway(ctx: RepairContext): Promise<DetectedIssue | null> {
  const host = ctx.gatewayHost ?? "127.0.0.1";
  const port = ctx.gatewayPort ?? 18789;

  // First check if container is running
  const client = new DockerClient();
  try {
    const containers = await client.ps();
    const imageTag = ctx.imageTag ?? "openclaw:custom";
    const agentContainer = containers.find((c) => c.image === imageTag);

    if (!agentContainer || agentContainer.state !== "running") {
      return {
        type: "gateway_down",
        message: agentContainer
          ? `Container ${agentContainer.name} is ${agentContainer.state}`
          : "No agent container running",
        detectedAt: new Date().toISOString(),
      };
    }
  } catch (err: unknown) {
    return {
      type: "gateway_down",
      message: `Cannot check containers: ${err instanceof Error ? err.message : String(err)}`,
      detectedAt: new Date().toISOString(),
    };
  }

  // Then check Gateway health endpoint
  const health = await checkHealth({ host, port, signal: ctx.signal });
  if (health.status === "down") {
    return {
      type: "gateway_down",
      message: `Gateway at ${host}:${port} is down: ${health.error ?? "unreachable"}`,
      detectedAt: new Date().toISOString(),
    };
  }

  return null;
}

/**
 * Check network connectivity to the Gateway.
 *
 * Detects: network drop (Gateway was reachable but connection now fails).
 */
export async function checkNetwork(ctx: RepairContext): Promise<DetectedIssue | null> {
  const host = ctx.gatewayHost ?? "127.0.0.1";
  const port = ctx.gatewayPort ?? 18789;

  const health = await checkHealth({ host, port, signal: ctx.signal });
  if (health.status === "down" && health.error) {
    // Distinguish network errors from container-down errors
    const networkErrors = ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "fetch failed"];
    const errorMsg = health.error;
    const isNetworkError = networkErrors.some((e) => errorMsg.includes(e));

    if (isNetworkError) {
      return {
        type: "network_drop",
        message: `Network connection to Gateway failed: ${health.error}`,
        detectedAt: new Date().toISOString(),
      };
    }
  }

  return null;
}

/**
 * Check if the CLAWHQ_FWD firewall chain exists.
 *
 * Detects: chain missing (typically after docker compose down recreates the bridge).
 */
export async function checkFirewall(_ctx: RepairContext): Promise<DetectedIssue | null> {
  try {
    const exists = await chainExists(CHAIN_NAME);
    if (!exists) {
      return {
        type: "firewall_missing",
        message: `Firewall chain ${CHAIN_NAME} does not exist (likely removed by network recreate)`,
        detectedAt: new Date().toISOString(),
      };
    }
  } catch {
    // Platform doesn't support iptables — not an issue to repair
    return null;
  }

  return null;
}

/**
 * Run all monitors and return detected issues.
 */
export async function detectIssues(ctx: RepairContext): Promise<DetectedIssue[]> {
  const issues: DetectedIssue[] = [];

  const checks = [
    checkGateway(ctx),
    checkNetwork(ctx),
    checkFirewall(ctx),
  ];

  const results = await Promise.allSettled(checks);

  for (const result of results) {
    if (result.status === "fulfilled" && result.value !== null) {
      issues.push(result.value);
    }
  }

  return issues;
}

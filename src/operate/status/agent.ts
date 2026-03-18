/**
 * Agent state collector.
 *
 * Queries Docker for container status/uptime and Gateway for health.
 * Gracefully handles the case where the agent is not running.
 */

import { DockerClient } from "../../build/docker/client.js";
import { checkHealth } from "../../gateway/health.js";

import type { AgentStatus } from "./types.js";

/**
 * Collect agent state: container info + gateway health.
 */
export async function collectAgentStatus(options: {
  composePath?: string;
  gatewayHost?: string;
  gatewayPort?: number;
} = {}): Promise<AgentStatus> {
  const gatewayHost = options.gatewayHost ?? "127.0.0.1";
  const gatewayPort = options.gatewayPort ?? 18789;

  const client = options.composePath
    ? new DockerClient({ cwd: options.composePath.replace(/\/[^/]+$/, "") })
    : new DockerClient();

  // Collect container info
  let containerId: string | undefined;
  let containerName: string | undefined;
  let containerState: string | undefined;
  let containerStatus: string | undefined;
  let image: string | undefined;

  try {
    const containers = await client.ps();
    if (containers.length > 0) {
      const c = containers[0];
      containerId = c.id;
      containerName = c.name;
      containerState = c.state;
      containerStatus = c.status;
      image = c.image;
    }
  } catch {
    // Docker not available or compose not configured — agent is stopped
  }

  // Collect gateway health
  let gatewayStatus: "up" | "down" | "degraded" = "down";
  let gatewayLatencyMs: number | undefined;

  try {
    const health = await checkHealth({ host: gatewayHost, port: gatewayPort });
    gatewayStatus = health.status;
    gatewayLatencyMs = health.latencyMs;
  } catch {
    // Gateway unreachable
  }

  // Determine overall agent state
  if (!containerState || containerState === "exited" || containerState === "dead") {
    return {
      state: "stopped",
      gatewayStatus,
      gatewayLatencyMs,
    };
  }

  if (containerState === "running" && gatewayStatus === "up") {
    return {
      state: "running",
      containerId,
      containerName,
      image,
      uptime: containerStatus,
      gatewayStatus,
      gatewayLatencyMs,
    };
  }

  // Container running but gateway not healthy
  return {
    state: "degraded",
    containerId,
    containerName,
    image,
    uptime: containerStatus,
    gatewayStatus,
    gatewayLatencyMs,
  };
}

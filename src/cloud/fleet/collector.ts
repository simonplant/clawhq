/**
 * Fleet status collector.
 *
 * Collects status from all discovered agents in parallel, then aggregates
 * into health, cost, and security summaries.
 */

import { collectStatus } from "../../operate/status/collector.js";
import type { StatusReport } from "../../operate/status/types.js";

import type {
  FleetAgent,
  FleetAgentStatus,
  FleetCostSummary,
  FleetHealthSummary,
  FleetReport,
  FleetSecuritySummary,
} from "./types.js";

/**
 * Collect status for a single agent, returning a FleetAgentStatus.
 * Errors are caught and recorded per-agent without failing the fleet.
 */
async function collectAgentFleetStatus(
  agent: FleetAgent,
): Promise<FleetAgentStatus> {
  try {
    const report: StatusReport = await collectStatus({
      openclawHome: agent.openclawHome,
      envPath: `${agent.openclawHome}/.env`,
    });

    return {
      agent,
      status: report.agent,
      integrations: report.integrations,
      workspace: report.workspace,
      egress: report.egress,
    };
  } catch (err: unknown) {
    return {
      agent,
      status: {
        state: "unknown",
        gatewayStatus: "down",
      },
      integrations: { integrations: [], counts: { valid: 0, expired: 0, failing: 0, error: 0, missing: 0 } },
      workspace: { memoryTiers: [], identityFiles: [], totalMemoryBytes: 0, totalIdentityTokens: 0 },
      egress: {
        today: { label: "Today", bytes: 0, calls: 0 },
        week: { label: "Week", bytes: 0, calls: 0 },
        month: { label: "Month", bytes: 0, calls: 0 },
        zeroEgress: true,
      },
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Aggregate health summary from per-agent statuses.
 */
function aggregateHealth(agents: FleetAgentStatus[]): FleetHealthSummary {
  const summary: FleetHealthSummary = {
    total: agents.length,
    running: 0,
    stopped: 0,
    degraded: 0,
    unknown: 0,
  };

  for (const a of agents) {
    const state = a.status.state;
    if (state === "running") summary.running++;
    else if (state === "stopped") summary.stopped++;
    else if (state === "degraded") summary.degraded++;
    else summary.unknown++;
  }

  return summary;
}

/**
 * Aggregate cost/egress summary from per-agent statuses.
 */
function aggregateCost(agents: FleetAgentStatus[]): FleetCostSummary {
  let totalBytes = 0;
  let totalCalls = 0;
  let zeroCount = 0;

  const perAgent = agents.map((a) => {
    const bytes = a.egress.month.bytes;
    const calls = a.egress.month.calls;
    totalBytes += bytes;
    totalCalls += calls;
    if (a.egress.zeroEgress) zeroCount++;

    return {
      agentId: a.agent.id,
      egressBytes: bytes,
      egressCalls: calls,
      zeroEgress: a.egress.zeroEgress,
    };
  });

  return {
    totalEgressBytes: totalBytes,
    totalEgressCalls: totalCalls,
    zeroEgressCount: zeroCount,
    perAgent,
  };
}

/**
 * Aggregate security posture from per-agent integration health.
 */
function aggregateSecurity(agents: FleetAgentStatus[]): FleetSecuritySummary {
  let totalIntegrations = 0;
  let validCount = 0;
  let failingCount = 0;

  const perAgent = agents.map((a) => {
    const counts = a.integrations.counts;
    const valid = counts.valid;
    const failing = counts.failing + counts.expired + counts.error;
    const total = a.integrations.integrations.length - counts.missing;
    totalIntegrations += total;
    validCount += valid;
    failingCount += failing;

    return {
      agentId: a.agent.id,
      valid,
      failing,
      total,
    };
  });

  return {
    totalIntegrations,
    validCount,
    failingCount,
    perAgent,
  };
}

/**
 * Collect fleet-wide status from all discovered agents.
 */
export async function collectFleetStatus(
  agents: FleetAgent[],
): Promise<FleetReport> {
  // Collect all agent statuses in parallel
  const agentStatuses = await Promise.all(
    agents.map((agent) => collectAgentFleetStatus(agent)),
  );

  return {
    timestamp: new Date().toISOString(),
    agents: agentStatuses,
    health: aggregateHealth(agentStatuses),
    cost: aggregateCost(agentStatuses),
    security: aggregateSecurity(agentStatuses),
  };
}

/**
 * Fleet health aggregation — single pane of glass for all agents.
 *
 * Aggregates health from discovered agents into a unified view.
 * Reports operational metadata only, never content.
 */

import { discoverFleet } from "./discovery.js";
import type { FleetHealthStatus } from "./types.js";

/**
 * Aggregate health across all registered agents.
 *
 * Returns a single view with per-agent health and fleet-wide counts.
 */
export function getFleetHealth(deployDir: string): FleetHealthStatus {
  const discovery = discoverFleet(deployDir);

  let healthyCount = 0;
  let unhealthyCount = 0;
  let unavailableCount = 0;

  for (const agent of discovery.agents) {
    if (!agent.exists || !agent.configured) {
      unavailableCount++;
    } else if (agent.health?.containerRunning) {
      healthyCount++;
    } else {
      unhealthyCount++;
    }
  }

  return {
    agents: discovery.agents,
    healthyCount,
    unhealthyCount,
    unavailableCount,
    allHealthy: unhealthyCount === 0 && unavailableCount === 0 && healthyCount > 0,
    timestamp: new Date().toISOString(),
  };
}

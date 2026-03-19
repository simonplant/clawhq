/**
 * Fleet-wide doctor — surface issues across all agents in one check.
 *
 * Runs the full doctor diagnostic suite against every registered agent
 * in parallel, then aggregates results into a single fleet report.
 */

import { existsSync } from "node:fs";

import { runDoctor } from "../../operate/doctor/doctor.js";

import { readFleetRegistry } from "./discovery.js";
import type { FleetAgentDoctorResult, FleetDoctorReport } from "./types.js";

/**
 * Run doctor checks across all registered agents.
 *
 * Each agent's checks run in parallel. Agents whose deployment directory
 * doesn't exist are reported as unreachable.
 */
export async function runFleetDoctor(
  deployDir: string,
  signal?: AbortSignal,
): Promise<FleetDoctorReport> {
  const registry = readFleetRegistry(deployDir);

  const results = await Promise.all(
    registry.agents.map(async (agent): Promise<FleetAgentDoctorResult> => {
      if (!existsSync(agent.deployDir)) {
        return {
          name: agent.name,
          deployDir: agent.deployDir,
          error: "Deployment directory does not exist",
        };
      }

      try {
        const report = await runDoctor({
          deployDir: agent.deployDir,
          signal,
        });
        return { name: agent.name, deployDir: agent.deployDir, report };
      } catch (err) {
        return {
          name: agent.name,
          deployDir: agent.deployDir,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  let healthyCount = 0;
  let unhealthyCount = 0;
  let unreachableCount = 0;

  for (const result of results) {
    if (result.error) {
      unreachableCount++;
    } else if (result.report?.healthy) {
      healthyCount++;
    } else {
      unhealthyCount++;
    }
  }

  return {
    agents: results,
    healthyCount,
    unhealthyCount,
    unreachableCount,
    allHealthy: unhealthyCount === 0 && unreachableCount === 0 && healthyCount > 0,
    timestamp: new Date().toISOString(),
  };
}

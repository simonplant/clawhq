/**
 * Fleet-wide doctor diagnostics.
 *
 * Runs the standard doctor checks across all discovered agents
 * and aggregates results into a fleet doctor report.
 */

import { join } from "node:path";

import { runChecks } from "../../operate/doctor/runner.js";
import type { DoctorContext } from "../../operate/doctor/types.js";

import type { FleetAgent, FleetDoctorEntry, FleetDoctorReport } from "./types.js";

/**
 * Run doctor checks for a single agent.
 */
async function runAgentDoctor(agent: FleetAgent): Promise<FleetDoctorEntry> {
  const ctx: DoctorContext = {
    openclawHome: agent.openclawHome,
    configPath: join(agent.openclawHome, "openclaw.json"),
    composePath: join(agent.openclawHome, "docker-compose.yml"),
    envPath: join(agent.openclawHome, ".env"),
  };

  try {
    const report = await runChecks(ctx);
    return {
      agentId: agent.id,
      report,
    };
  } catch (err: unknown) {
    return {
      agentId: agent.id,
      report: {
        checks: [],
        passed: false,
        counts: { pass: 0, warn: 0, fail: 0 },
      },
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Run doctor diagnostics across all fleet agents.
 */
export async function runFleetDoctor(
  agents: FleetAgent[],
): Promise<FleetDoctorReport> {
  // Run doctor on all agents in parallel
  const entries = await Promise.all(
    agents.map((agent) => runAgentDoctor(agent)),
  );

  const totals = { pass: 0, warn: 0, fail: 0 };
  let allPassed = true;

  for (const entry of entries) {
    totals.pass += entry.report.counts.pass;
    totals.warn += entry.report.counts.warn;
    totals.fail += entry.report.counts.fail;
    if (!entry.report.passed || entry.error) {
      allPassed = false;
    }
  }

  return {
    timestamp: new Date().toISOString(),
    entries,
    allPassed,
    totals,
  };
}

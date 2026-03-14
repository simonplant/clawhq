/**
 * `clawhq fleet` subcommand — multi-agent fleet management dashboard.
 *
 * Shows aggregated health, cost, and security across all agents,
 * with per-agent drill-down and fleet-wide diagnostics.
 */

import { Command } from "commander";

import {
  collectFleetStatus,
  discoverAgents,
  formatFleetDashboard,
  formatFleetDoctorJson,
  formatFleetDoctorTable,
  formatFleetJson,
  runFleetDoctor,
} from "../fleet/index.js";

/**
 * Create the `fleet` command group.
 */
export function createFleetCommand(): Command {
  const fleetCmd = new Command("fleet")
    .description("Fleet management — multi-agent dashboard")
    .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
    .option("--config <path>", "Path to openclaw.json");

  fleetCmd
    .command("status", { isDefault: true })
    .description("Show aggregated health, cost, and security across all agents")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const parentOpts = fleetCmd.opts() as { home: string; config?: string };
      const homeDir = parentOpts.home.replace(/^~/, process.env.HOME ?? "~");

      const agents = await discoverAgents({
        openclawHome: homeDir,
        configPath: parentOpts.config,
      });

      if (agents.length === 0) {
        console.log("No agents discovered. Check that openclaw.json exists and has agents configured.");
        return;
      }

      if (agents.length < 2) {
        console.log("Fleet view requires 2+ agents. Use `clawhq status` for single-agent deployments.");
        console.log("Add agents with `clawhq agent add <id>`.");
        return;
      }

      const report = await collectFleetStatus(agents);

      if (opts.json) {
        console.log(formatFleetJson(report));
      } else {
        console.log(formatFleetDashboard(report));
      }
    });

  fleetCmd
    .command("doctor")
    .description("Run diagnostics across all fleet agents")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const parentOpts = fleetCmd.opts() as { home: string; config?: string };
      const homeDir = parentOpts.home.replace(/^~/, process.env.HOME ?? "~");

      const agents = await discoverAgents({
        openclawHome: homeDir,
        configPath: parentOpts.config,
      });

      if (agents.length === 0) {
        console.log("No agents discovered. Check that openclaw.json exists and has agents configured.");
        return;
      }

      const report = await runFleetDoctor(agents);

      if (opts.json) {
        console.log(formatFleetDoctorJson(report));
      } else {
        console.log(formatFleetDoctorTable(report));
      }

      if (!report.allPassed) {
        process.exitCode = 1;
      }
    });

  return fleetCmd;
}

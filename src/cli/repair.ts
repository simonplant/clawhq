/**
 * `clawhq repair` command — health self-repair (auto-recovery).
 */

import { Command } from "commander";

import type { RepairConfig, RepairContext } from "../repair/index.js";
import {
  DEFAULT_REPAIR_CONFIG,
  formatRepairJson,
  formatRepairReport,
  readRepairLog,
  runRepair,
} from "../repair/index.js";

/**
 * Create the `repair` command.
 */
export function createRepairCommand(): Command {
  return new Command("repair")
    .description("Run all recovery checks and auto-repair detected issues")
    .option("--json", "Output results as JSON")
    .option("--log", "Show repair audit log")
    .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
    .option("--config <path>", "Path to openclaw.json", "~/.openclaw/openclaw.json")
    .option("--compose <path>", "Path to docker-compose.yml")
    .option("--env <path>", "Path to .env file")
    .option("--image-tag <tag>", "Expected agent image tag", "openclaw:custom")
    .option("--gateway-host <host>", "Gateway host", "127.0.0.1")
    .option("--gateway-port <port>", "Gateway port", "18789")
    .option("--bridge <iface>", "Docker bridge interface", "docker0")
    .option("--no-gateway-restart", "Disable auto-restart on Gateway crash")
    .option("--no-network-reconnect", "Disable auto-reconnect on network drop")
    .option("--no-firewall-reapply", "Disable auto-reapply on bridge change")
    .action(async (opts: {
      json?: boolean;
      log?: boolean;
      home: string;
      config: string;
      compose?: string;
      env?: string;
      imageTag: string;
      gatewayHost: string;
      gatewayPort: string;
      bridge: string;
      gatewayRestart: boolean;
      networkReconnect: boolean;
      firewallReapply: boolean;
    }) => {
      const homePath = opts.home.replace(/^~/, process.env.HOME ?? "~");
      const configPath = opts.config.replace(/^~/, process.env.HOME ?? "~");

      // Show audit log
      if (opts.log) {
        const entries = await readRepairLog(homePath);
        if (entries.length === 0) {
          console.log("No repair actions logged.");
          return;
        }
        if (opts.json) {
          console.log(JSON.stringify(entries, null, 2));
        } else {
          for (const entry of entries) {
            console.log(
              `${entry.timestamp}  ${entry.status.toUpperCase().padEnd(8)}  ${entry.action}: ${entry.message}`,
            );
          }
        }
        return;
      }

      const ctx: RepairContext = {
        openclawHome: homePath,
        configPath,
        composePath: opts.compose,
        envPath: opts.env,
        imageTag: opts.imageTag,
        gatewayHost: opts.gatewayHost,
        gatewayPort: parseInt(opts.gatewayPort, 10),
        bridgeInterface: opts.bridge,
      };

      const repairConfig: RepairConfig = {
        ...DEFAULT_REPAIR_CONFIG,
        gatewayRestart: opts.gatewayRestart,
        networkReconnect: opts.networkReconnect,
        firewallReapply: opts.firewallReapply,
      };

      const report = await runRepair(ctx, repairConfig);

      if (opts.json) {
        console.log(formatRepairJson(report));
      } else {
        console.log(formatRepairReport(report));
      }

      if (!report.allHealthy) {
        process.exitCode = 1;
      }
    });
}

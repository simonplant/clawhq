/**
 * `clawhq repair` command — health self-repair (auto-recovery).
 */

import chalk from "chalk";
import { Command } from "commander";

import type { RepairConfig, RepairContext } from "../repair/index.js";
import {
  DEFAULT_REPAIR_CONFIG,
  formatRepairJson,
  formatRepairReport,
  readRepairLog,
  runRepair,
  startWatcher,
} from "../repair/index.js";

import { spinner, status } from "./ui.js";

/**
 * Create the `repair` command.
 */
export function createRepairCommand(): Command {
  return new Command("repair")
    .description("Run all recovery checks and auto-repair detected issues")
    .option("--json", "Output results as JSON")
    .option("--log", "Show repair audit log")
    .option("--watch", "Continuous monitoring with auto-repair (every 30s)")
    .option("--interval <seconds>", "Watch interval in seconds", "30")
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
      watch?: boolean;
      interval: string;
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

      // Watch mode: continuous monitoring with auto-repair
      if (opts.watch) {
        const intervalMs = parseInt(opts.interval, 10) * 1000;
        console.log(
          `${chalk.magenta("Operate")} Starting continuous health monitor (every ${opts.interval}s)...`,
        );

        const watcher = startWatcher({
          ctx,
          config: repairConfig,
          intervalMs,
          onCycle(report) {
            const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
            if (report.issues.length === 0) {
              console.log(`${ts}  ${status.pass} All systems healthy`);
            } else {
              for (const action of report.actions) {
                const label = action.status === "repaired"
                  ? status.pass
                  : action.status === "failed"
                    ? status.fail
                    : chalk.yellow("SKIP");
                console.log(
                  `${ts}  ${label} ${action.action}: ${action.message}`,
                );
              }
            }
          },
          onError(err) {
            console.error(
              `${chalk.red("ERROR")} Repair cycle failed: ${err.message}`,
            );
          },
        });

        // Clean exit on SIGINT/SIGTERM
        const cleanup = () => {
          watcher.stop();
        };
        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);

        await watcher.done;
        return;
      }

      // One-shot mode
      const repairSpinner = spinner(`${chalk.magenta("Operate")} Running repair checks...`);
      repairSpinner.start();

      const report = await runRepair(ctx, repairConfig);

      if (report.allHealthy) {
        repairSpinner.succeed(`${chalk.magenta("Operate")} ${status.pass} All systems healthy`);
      } else {
        repairSpinner.fail(`${chalk.magenta("Operate")} ${status.fail} Issues detected`);
      }

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

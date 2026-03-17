/**
 * `clawhq doctor`, `clawhq status`, and `clawhq logs` commands.
 */

import { Command } from "commander";

import {
  collectMetrics,
  formatAlertJson,
  formatAlertSummary,
  formatAlertTable,
  generateAlerts,
} from "../alerts/index.js";
import { appendSnapshot, loadHistory as loadAlertHistory } from "../alerts/store.js";
import { runFixes } from "../doctor/fix.js";
import { formatJson, formatTable, runChecks } from "../doctor/runner.js";
import type { DoctorContext } from "../doctor/types.js";
import type { LogCategory } from "../logs/index.js";
import {
  formatCronHistory,
  readCronHistory,
  streamContainerLogs,
} from "../logs/index.js";
import { collectStatus } from "../status/collector.js";
import { formatDashboard, formatJson as formatStatusJson } from "../status/format.js";

/**
 * Register operate-phase commands (doctor, status, logs) on the program.
 */
export function createOperateCommands(program: Command): void {
  program
    .command("doctor")
    .description("Run preventive diagnostics")
    .option("--json", "Output results as JSON")
    .option("--fix", "Auto-fix safe issues (permissions)")
    .option("--config <path>", "Path to openclaw.json", "~/.openclaw/openclaw.json")
    .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
    .option("--compose <path>", "Path to docker-compose.yml")
    .option("--env <path>", "Path to .env file")
    .option("--image-tag <tag>", "Expected agent image tag", "openclaw:custom")
    .option("--base-tag <tag>", "Expected base image tag", "openclaw:local")
    .action(async (opts: {
      json?: boolean;
      fix?: boolean;
      config: string;
      home: string;
      compose?: string;
      env?: string;
      imageTag: string;
      baseTag: string;
    }) => {
      const homePath = opts.home.replace(/^~/, process.env.HOME ?? "~");
      const configPath = opts.config.replace(/^~/, process.env.HOME ?? "~");

      const ctx: DoctorContext = {
        openclawHome: homePath,
        configPath,
        composePath: opts.compose,
        envPath: opts.env,
        imageTag: opts.imageTag,
        baseTag: opts.baseTag,
      };

      // Run --fix mode
      if (opts.fix) {
        const fixes = await runFixes(ctx);
        if (fixes.length === 0) {
          console.log("No auto-fixable issues found.");
          return;
        }
        for (const fix of fixes) {
          const icon = fix.fixed ? "FIXED" : "ERROR";
          console.log(`${icon}  ${fix.name}: ${fix.message}`);
        }
        const allFixed = fixes.every((f) => f.fixed);
        if (!allFixed) {
          process.exitCode = 1;
        }
        return;
      }

      // Run diagnostics
      const report = await runChecks(ctx);

      if (opts.json) {
        console.log(formatJson(report));
      } else {
        console.log(formatTable(report));
      }

      if (!report.passed) {
        process.exitCode = 1;
      }
    });

  program
    .command("status")
    .description("Show agent status dashboard")
    .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
    .option("--env <path>", "Path to .env file")
    .option("--compose <path>", "Path to docker-compose.yml")
    .option("--gateway-host <host>", "Gateway host", "127.0.0.1")
    .option("--gateway-port <port>", "Gateway port", "18789")
    .option("--egress-log <path>", "Path to egress log file")
    .option("--json", "Output as JSON")
    .option("--watch", "Live-updating display (refresh every 5s)")
    .action(async (opts: {
      home: string;
      env?: string;
      compose?: string;
      gatewayHost: string;
      gatewayPort: string;
      egressLog?: string;
      json?: boolean;
      watch?: boolean;
    }) => {
      const statusOpts = {
        openclawHome: opts.home.replace(/^~/, process.env.HOME ?? "~"),
        envPath: opts.env?.replace(/^~/, process.env.HOME ?? "~"),
        composePath: opts.compose,
        gatewayHost: opts.gatewayHost,
        gatewayPort: parseInt(opts.gatewayPort, 10),
        egressLogPath: opts.egressLog?.replace(/^~/, process.env.HOME ?? "~"),
      };

      const run = async () => {
        const report = await collectStatus(statusOpts);

        // Collect metrics and append to history for trend analysis
        const snapshot = collectMetrics(report);
        await appendSnapshot(statusOpts.openclawHome, snapshot).catch(() => {
          // Silently ignore history write errors — alerts are non-blocking
        });

        if (opts.json) {
          console.log(formatStatusJson(report));
        } else {
          console.log(formatDashboard(report));

          // Show alert summary if there are any active alerts
          const history = await loadAlertHistory(statusOpts.openclawHome).catch(() => []);
          const alertReport = generateAlerts(history);
          if (alertReport.alerts.length > 0) {
            console.log(formatAlertSummary(alertReport));
          }
        }
      };

      if (!opts.watch) {
        await run();
        return;
      }

      // Watch mode: clear screen and refresh every 5 seconds
      const refresh = async () => {
        process.stdout.write("\x1B[2J\x1B[H");
        await run();
      };

      await refresh();
      const interval = setInterval(() => {
        refresh().catch((err: unknown) => {
          console.error(err instanceof Error ? err.message : String(err));
        });
      }, 5000);

      // Clean exit on SIGINT/SIGTERM
      const cleanup = () => {
        clearInterval(interval);
        process.exit(0);
      };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);
    });

  program
    .command("logs")
    .description("Stream agent logs")
    .option("--follow, -f", "Follow log output in real-time")
    .option("--category <type>", "Filter by category (agent, gateway, cron, error)")
    .option("--cron <job>", "Show execution history for a specific cron job")
    .option("--since <duration>", "Show logs since duration (e.g. 30m, 1h, 2d)")
    .option("--tail <lines>", "Number of lines to show from end")
    .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
    .action(async (opts) => {
      const openclawHome = opts.home.replace(/^~/, process.env.HOME ?? "~");

      // --cron mode: show cron job execution history
      if (opts.cron) {
        try {
          const entries = await readCronHistory(openclawHome, opts.cron, {
            since: opts.since,
          });
          console.log(formatCronHistory(entries));
        } catch (err: unknown) {
          console.error(
            `Failed to read cron history: ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exitCode = 1;
        }
        return;
      }

      // Validate category if provided
      const validCategories: LogCategory[] = ["agent", "gateway", "cron", "error"];
      if (opts.category && !validCategories.includes(opts.category as LogCategory)) {
        console.error(
          `Invalid category "${opts.category}". Valid: ${validCategories.join(", ")}`,
        );
        process.exitCode = 1;
        return;
      }

      // Set up abort controller for graceful shutdown
      const ac = new AbortController();
      const onSignal = () => ac.abort();
      process.on("SIGINT", onSignal);
      process.on("SIGTERM", onSignal);

      try {
        await streamContainerLogs({
          openclawHome,
          follow: Boolean(opts.follow),
          category: opts.category as LogCategory | undefined,
          since: opts.since,
          tail: opts.tail ? parseInt(opts.tail, 10) : undefined,
          signal: ac.signal,
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          // Graceful shutdown via Ctrl+C
          return;
        }
        console.error(
          `Log streaming failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      } finally {
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
      }
    });
}

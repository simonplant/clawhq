import { join } from "node:path";

import type { Command } from "commander";

import chalk from "chalk";
import ora from "ora";

import { GATEWAY_DEFAULT_PORT } from "../../config/defaults.js";
import {
  createBackup,
  listSnapshots,
  restoreBackup,
} from "../../operate/backup/index.js";
import type { BackupProgress } from "../../operate/backup/index.js";
import {
  formatDoctorJson,
  formatDoctorTable,
  formatFixTable,
  runDoctor,
  runDoctorWithFix,
} from "../../operate/doctor/index.js";
import { streamLogs } from "../../operate/logs/index.js";
import {
  formatMonitorEvent,
  formatMonitorStateJson,
  formatMonitorStateTable,
  startMonitor,
} from "../../operate/monitor/index.js";
import type { MonitorEvent, NotificationChannel, TelegramNotificationChannel } from "../../operate/monitor/index.js";
import {
  formatStatusJson,
  formatStatusTable,
  getStatus,
  watchStatus,
} from "../../operate/status/index.js";
import {
  applyUpdate,
  checkForUpdates,
} from "../../operate/updater/index.js";
import type { UpdateProgress } from "../../operate/updater/index.js";

import { CommandError } from "../errors.js";
import { renderError, validatePort, ensureInstalled } from "../ux.js";

async function loadNotificationChannels(deployDir: string): Promise<NotificationChannel[]> {
  const channels: NotificationChannel[] = [];

  try {
    const { readEnvValue } = await import("../../secure/credentials/env-store.js");
    const envPath = join(deployDir, "engine", ".env");

    // Telegram channel
    const botToken = readEnvValue(envPath, "TELEGRAM_BOT_TOKEN");
    const chatId = readEnvValue(envPath, "TELEGRAM_CHAT_ID");
    if (botToken && chatId) {
      channels.push({
        type: "telegram",
        enabled: true,
        botToken,
        chatId,
      } satisfies TelegramNotificationChannel);
    }

    // Webhook channel
    const webhookUrl = readEnvValue(envPath, "CLAWHQ_WEBHOOK_URL");
    if (webhookUrl) {
      channels.push({
        type: "webhook",
        enabled: true,
        url: webhookUrl,
      });
    }
  } catch (error) {
    console.warn("Notification channel config failed — monitor will run without notifications:", error);
  }

  return channels;
}

export function registerOperateCommands(program: Command, defaultDeployDir: string): void {
  program
    .command("doctor")
    .description("Preventive diagnostics — 17 checks with auto-fix")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--fix", "Auto-fix common issues")
    .option("--json", "Output as JSON for scripting")
    .action(async (opts: {
      deployDir: string;
      fix?: boolean;
      json?: boolean;
    }) => {
      ensureInstalled(opts.deployDir);

      const ac = new AbortController();
      process.on("SIGINT", () => ac.abort());
      process.on("SIGTERM", () => ac.abort());

      const format = opts.json ? "json" : "table";

      if (opts.fix) {
        const spinner = ora("Running diagnostics and auto-fix…");
        if (!opts.json) spinner.start();

        try {
          const { report, fixReport } = await runDoctorWithFix({
            deployDir: opts.deployDir,
            fix: true,
            format,
            signal: ac.signal,
          });

          if (!opts.json) spinner.stop();

          if (opts.json) {
            console.log(formatDoctorJson(report, fixReport));
          } else {
            console.log(formatFixTable(fixReport));
            console.log("");
            console.log(formatDoctorTable(report));
          }

          if (!report.healthy) throw new CommandError("", 1);
        } finally {
          spinner.stop();
        }
      } else {
        const spinner = ora("Running diagnostics…");
        if (!opts.json) spinner.start();

        try {
          const report = await runDoctor({
            deployDir: opts.deployDir,
            format,
            signal: ac.signal,
          });

          if (!opts.json) spinner.stop();

          if (opts.json) {
            console.log(formatDoctorJson(report));
          } else {
            console.log(formatDoctorTable(report));
          }

          if (!report.healthy) throw new CommandError("", 1);
        } finally {
          spinner.stop();
        }
      }
    });

  program
    .command("status")
    .description("Single-pane status dashboard")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("-w, --watch", "Continuous monitoring mode")
    .option("--json", "Output as JSON for scripting")
    .option("-i, --interval <seconds>", "Watch refresh interval in seconds", "5")
    .action(async (opts: { deployDir: string; watch?: boolean; json?: boolean; interval: string }) => {
      ensureInstalled(opts.deployDir);

      try {
        if (opts.watch) {
          const ac = new AbortController();
          process.on("SIGINT", () => ac.abort());
          process.on("SIGTERM", () => ac.abort());

          const intervalMs = Math.max(1, parseInt(opts.interval, 10)) * 1000;

          await watchStatus({
            deployDir: opts.deployDir,
            signal: ac.signal,
            intervalMs,
            onUpdate: (snapshot) => {
              // Clear screen for dashboard refresh
              process.stdout.write("\x1B[2J\x1B[H");
              if (opts.json) {
                console.log(formatStatusJson(snapshot));
              } else {
                console.log(formatStatusTable(snapshot));
                console.log(chalk.dim(`\n  Refreshing every ${opts.interval}s — Ctrl+C to stop`));
              }
            },
          });
        } else {
          const spinner = ora("Gathering status…");
          if (!opts.json) spinner.start();

          try {
            const snapshot = await getStatus({
              deployDir: opts.deployDir,
            });

            if (!opts.json) spinner.stop();

            if (opts.json) {
              console.log(formatStatusJson(snapshot));
            } else {
              console.log(formatStatusTable(snapshot));
            }

            if (!snapshot.healthy) throw new CommandError("", 1);
          } finally {
            spinner.stop();
          }
        }
      } catch (error) {
        if (error instanceof CommandError) throw error;
        console.error(renderError(error));
        throw new CommandError("", 1);
      }
    });

  const backup = program.command("backup").description("Encrypted backup and restore");

  backup
    .command("create")
    .description("Create encrypted backup snapshot")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("-p, --passphrase <passphrase>", "GPG passphrase for encryption")
    .action(async (opts: { deployDir: string; passphrase?: string }) => {
      ensureInstalled(opts.deployDir);

      if (!opts.passphrase) {
        console.error(chalk.red("Error: --passphrase is required for encrypted backup."));
        throw new CommandError("", 1);
      }

      const spinner = ora("Creating encrypted backup…");
      spinner.start();

      try {
        const result = await createBackup({
          deployDir: opts.deployDir,
          passphrase: opts.passphrase,
          onProgress: (p: BackupProgress) => {
            spinner.text = p.message;
          },
        });

        spinner.stop();

        if (!result.success) {
          console.error(chalk.red(`Backup failed: ${result.error}`));
          throw new CommandError("", 1);
        }

        console.log(chalk.green(`\n✔ Snapshot created: ${result.snapshotId}`));
        console.log(`  Path: ${result.snapshotPath}`);
        if (result.manifest) {
          console.log(`  Files: ${result.manifest.fileCount}`);
          console.log(`  SHA-256: ${result.manifest.sha256.slice(0, 16)}…`);
        }
      } finally {
        spinner.stop();
      }
    });

  backup
    .command("list")
    .description("List available backup snapshots")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Output as JSON")
    .action(async (opts: { deployDir: string; json?: boolean }) => {
      ensureInstalled(opts.deployDir);

      const snapshots = await listSnapshots(opts.deployDir);

      if (opts.json) {
        console.log(JSON.stringify(snapshots, null, 2));
        return;
      }

      if (snapshots.length === 0) {
        console.log(chalk.yellow("No backup snapshots found."));
        return;
      }

      console.log(chalk.bold(`\n${snapshots.length} snapshot(s):\n`));
      for (const snap of snapshots) {
        const size = snap.archiveSize < 1024 * 1024
          ? `${(snap.archiveSize / 1024).toFixed(1)} KB`
          : `${(snap.archiveSize / (1024 * 1024)).toFixed(1)} MB`;
        console.log(`  ${chalk.cyan(snap.snapshotId)}`);
        console.log(`    Created: ${snap.createdAt}`);
        console.log(`    Size: ${size}  Files: ${snap.fileCount}`);
        console.log(`    SHA-256: ${snap.sha256.slice(0, 16)}…`);
        console.log("");
      }
    });

  backup
    .command("restore")
    .description("Restore from a backup snapshot")
    .argument("<snapshot>", "Snapshot ID or path to .gpg file")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("-p, --passphrase <passphrase>", "GPG passphrase for decryption")
    .action(async (snapshot: string, opts: { deployDir: string; passphrase?: string }) => {
      if (!opts.passphrase) {
        console.error(chalk.red("Error: --passphrase is required for restore."));
        throw new CommandError("", 1);
      }

      const spinner = ora("Restoring from backup…");
      spinner.start();

      try {
        const result = await restoreBackup({
          deployDir: opts.deployDir,
          snapshot,
          passphrase: opts.passphrase,
          onProgress: (p: BackupProgress) => {
            spinner.text = p.message;
          },
        });

        spinner.stop();

        if (!result.success) {
          console.error(chalk.red(`Restore failed: ${result.error}`));
          throw new CommandError("", 1);
        }

        console.log(chalk.green(`\n✔ Restore complete`));
        if (result.fileCount != null) {
          console.log(`  Entries restored: ${result.fileCount}`);
        }

        if (result.doctorHealthy) {
          console.log(chalk.green("  Doctor check: HEALTHY"));
        } else {
          console.log(chalk.yellow("  Doctor check: issues detected — run `clawhq doctor` for details"));
        }
      } finally {
        spinner.stop();
      }
    });

  program
    .command("update")
    .description("Safe upstream upgrade with rollback")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--check", "Check for updates without applying")
    .option("-p, --passphrase <passphrase>", "Passphrase for pre-update backup encryption")
    .option("-t, --token <token>", "Gateway auth token for post-update verification")
    .option("--port <port>", "Gateway port", String(GATEWAY_DEFAULT_PORT))
    .action(async (opts: {
      deployDir: string;
      check?: boolean;
      passphrase?: string;
      token?: string;
      port: string;
    }) => {
      ensureInstalled(opts.deployDir);

      const gatewayPort = validatePort(opts.port);

      const ac = new AbortController();
      process.on("SIGINT", () => ac.abort());
      process.on("SIGTERM", () => ac.abort());

      const spinner = ora();
      const onProgress = (event: UpdateProgress): void => {
        const label = chalk.dim(`[${event.step}]`);
        switch (event.status) {
          case "running": spinner.start(`${label} ${event.message}`); break;
          case "done": spinner.succeed(`${label} ${event.message}`); break;
          case "failed": spinner.fail(`${label} ${event.message}`); break;
          case "skipped": spinner.warn(`${label} ${event.message}`); break;
        }
      };

      try {
        if (opts.check) {
          const result = await checkForUpdates({
            deployDir: opts.deployDir,
            checkOnly: true,
            onProgress,
            signal: ac.signal,
          });

          spinner.stop();

          if (result.error) {
            console.error(chalk.red(`\n✘ ${result.error}`));
            throw new CommandError("", 1);
          }

          if (result.available) {
            console.log(chalk.green("\n✔ Update available"));
            console.log(chalk.dim(`  Image: ${result.currentImage}`));
            console.log(chalk.dim("  Run: clawhq update --passphrase <passphrase> to apply"));
          } else {
            console.log(chalk.green("\n✔ Already up to date"));
            console.log(chalk.dim(`  Image: ${result.currentImage}`));
          }
        } else {
          const token = opts.token ?? process.env["CLAWHQ_GATEWAY_TOKEN"] ?? "";

          const result = await applyUpdate({
            deployDir: opts.deployDir,
            passphrase: opts.passphrase,
            gatewayToken: token,
            gatewayPort,
            onProgress,
            signal: ac.signal,
          });

          spinner.stop();

          if (result.success) {
            console.log(chalk.green("\n✔ Update applied successfully"));
            if (result.backupId) {
              console.log(chalk.dim(`  Pre-update backup: ${result.backupId}`));
            }
          } else {
            if (result.rolledBack) {
              console.log(chalk.yellow("\n⚠ Update failed — rolled back to previous state"));
              console.log(chalk.dim(`  Backup restored: ${result.backupId}`));
            }
            console.error(chalk.red(`\n✘ ${result.error}`));
            throw new CommandError("", 1);
          }
        }
      } catch (error) {
        spinner.stop();
        if (error instanceof CommandError) throw error;
        console.error(renderError(error));
        throw new CommandError("", 1);
      }
    });

  program
    .command("logs")
    .description("Stream agent logs")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("-f, --follow", "Follow log output")
    .option("-n, --lines <count>", "Number of lines to show", "50")
    .action(async (opts: { deployDir: string; follow?: boolean; lines: string }) => {
      ensureInstalled(opts.deployDir);

      const ac = new AbortController();
      process.on("SIGINT", () => ac.abort());
      process.on("SIGTERM", () => ac.abort());

      const lineCount = parseInt(opts.lines, 10);
      if (isNaN(lineCount)) {
        throw new CommandError("Invalid --lines value: must be a number");
      }

      try {
        if (opts.follow) {
          const result = await streamLogs({
            deployDir: opts.deployDir,
            follow: true,
            lines: lineCount,
            signal: ac.signal,
          });

          if (!result.success && !ac.signal.aborted) {
            console.error(chalk.red(`\n✘ ${result.error}`));
            throw new CommandError("", 1);
          }
        } else {
          const result = await streamLogs({
            deployDir: opts.deployDir,
            follow: false,
            lines: lineCount,
            signal: ac.signal,
          });

          if (!result.success) {
            console.error(chalk.red(`✘ ${result.error}`));
            throw new CommandError("", 1);
          }

          if (result.output) {
            console.log(result.output);
          } else {
            console.log(chalk.dim("No logs available."));
          }
        }
      } catch (error) {
        if (error instanceof CommandError) throw error;
        console.error(renderError(error));
        throw new CommandError("", 1);
      }
    });

  program
    .command("monitor")
    .description("Background health monitor with alerts, auto-recovery, and daily digest")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("-i, --interval <seconds>", "Check interval in seconds", "30")
    .option("--no-recovery", "Disable auto-recovery")
    .option("--no-alerts", "Disable alert notifications")
    .option("--no-digest", "Disable daily digest")
    .option("--digest-hour <hour>", "Hour (0-23) to send daily digest", "8")
    .option("--memory-lifecycle", "Enable scheduled memory lifecycle runs")
    .option("--memory-lifecycle-interval <hours>", "Memory lifecycle interval in hours", "6")
    .option("--json", "Output events as JSON")
    .action(async (opts: {
      deployDir: string;
      interval: string;
      recovery: boolean;
      alerts: boolean;
      digest: boolean;
      digestHour: string;
      memoryLifecycle?: boolean;
      memoryLifecycleInterval: string;
      json?: boolean;
    }) => {
      ensureInstalled(opts.deployDir);

      const ac = new AbortController();
      process.on("SIGINT", () => ac.abort());
      process.on("SIGTERM", () => ac.abort());

      // Build notification channels from .env
      const channels = await loadNotificationChannels(opts.deployDir);

      const parsedInterval = parseInt(opts.interval, 10);
      if (isNaN(parsedInterval)) {
        throw new CommandError("Invalid --interval value: must be a number");
      }
      const intervalMs = Math.max(10, parsedInterval) * 1000;
      const parsedDigestHour = parseInt(opts.digestHour, 10);
      if (isNaN(parsedDigestHour)) {
        throw new CommandError("Invalid --digest-hour value: must be a number");
      }
      const digestHour = Math.max(0, Math.min(23, parsedDigestHour));

      if (!opts.json) {
        console.log(chalk.green("Monitor daemon started."));
        console.log(chalk.dim(`  Interval: ${opts.interval}s`));
        console.log(chalk.dim(`  Recovery: ${opts.recovery ? "enabled" : "disabled"}`));
        console.log(chalk.dim(`  Alerts: ${opts.alerts ? "enabled" : "disabled"}`));
        console.log(chalk.dim(`  Digest: ${opts.digest ? `enabled (${digestHour}:00)` : "disabled"}`));
        console.log(chalk.dim(`  Channels: ${channels.length > 0 ? channels.map((c) => c.type).join(", ") : "none configured"}`));
        console.log(chalk.dim(`  Memory lifecycle: ${opts.memoryLifecycle ? `enabled (every ${opts.memoryLifecycleInterval}h)` : "disabled"}`));
        console.log(chalk.dim("  Press Ctrl+C to stop.\n"));
      }

      const onEvent = (event: MonitorEvent): void => {
        if (opts.json) {
          console.log(JSON.stringify(event));
        } else {
          const line = formatMonitorEvent(event);
          switch (event.type) {
            case "alert":
            case "error":
              console.log(chalk.red(line));
              break;
            case "recovery":
              console.log(chalk.yellow(line));
              break;
            case "digest":
              console.log(chalk.green(line));
              break;
            case "memory-lifecycle":
              console.log(chalk.cyan(line));
              break;
            default:
              console.log(chalk.dim(line));
          }
        }
      };

      const parsedMemoryLifecycleInterval = parseFloat(opts.memoryLifecycleInterval);
      if (isNaN(parsedMemoryLifecycleInterval)) {
        throw new CommandError("Invalid --memory-lifecycle-interval value: must be a number");
      }
      const memoryLifecycleIntervalMs =
        Math.max(1, parsedMemoryLifecycleInterval) * 3600_000;

      const state = await startMonitor({
        deployDir: opts.deployDir,
        intervalMs,
        recovery: {
          enabled: opts.recovery,
        },
        notify: {
          channels,
          alertsEnabled: opts.alerts,
          digestEnabled: opts.digest,
          digestHour,
        },
        memoryLifecycle: opts.memoryLifecycle
          ? { enabled: true, intervalMs: memoryLifecycleIntervalMs }
          : undefined,
        signal: ac.signal,
        onEvent,
      });

      if (opts.json) {
        console.log(formatMonitorStateJson(state));
      } else {
        console.log(formatMonitorStateTable(state));
      }
    });
}

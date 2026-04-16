import { join } from "node:path";

import chalk from "chalk";
import type { Command } from "commander";
import ora from "ora";

import { GATEWAY_DEFAULT_PORT } from "../../config/defaults.js";
import { installOpsAutomation } from "../../operate/automation/index.js";
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
  archiveSession,
  listSessions,
} from "../../operate/sessions/index.js";
import {
  formatStatusJson,
  formatStatusTable,
  getStatus,
  watchStatus,
} from "../../operate/status/index.js";
import {
  applyUpdate,
  checkForUpdates,
  formatIntelligenceReport,
} from "../../operate/updater/index.js";
import type { UpdateChannel, UpdateProgress } from "../../operate/updater/index.js";
import { CommandError } from "../errors.js";
import { createCommandScope, renderError, validatePort, ensureInstalled } from "../ux.js";

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

      const { signal } = createCommandScope();

      const format = opts.json ? "json" : "table";

      if (opts.fix) {
        const spinner = ora("Running diagnostics and auto-fix…");
        if (!opts.json) spinner.start();

        try {
          const { report, fixReport } = await runDoctorWithFix({
            deployDir: opts.deployDir,
            fix: true,
            format,
            signal: signal,
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
            signal: signal,
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
          const { signal: watchSignal, cleanup: watchCleanup } = createCommandScope();

          const intervalMs = Math.max(1, parseInt(opts.interval, 10)) * 1000;

          await watchStatus({
            deployDir: opts.deployDir,
            signal: watchSignal,
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
          watchCleanup();
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
    .description("Safe upstream upgrade with change intelligence, migrations, and rollback")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--check", "Check for updates with deployment-specific impact analysis")
    .option("-p, --passphrase <passphrase>", "Passphrase for pre-update backup encryption")
    .option("-t, --token <token>", "Gateway auth token for post-update verification")
    .option("--port <port>", "Gateway port", String(GATEWAY_DEFAULT_PORT))
    .option("--channel <channel>", "Update channel: security, stable, latest, pinned")
    .option("--dry-run", "Show migration plan without applying")
    .action(async (opts: {
      deployDir: string;
      check?: boolean;
      passphrase?: string;
      token?: string;
      port: string;
      channel?: string;
      dryRun?: boolean;
    }) => {
      ensureInstalled(opts.deployDir);

      const gatewayPort = validatePort(opts.port);

      const { signal } = createCommandScope();

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

      const validChannels = new Set(["security", "stable", "latest", "pinned"]);
      if (opts.channel && !validChannels.has(opts.channel)) {
        console.error(chalk.red(`\n✘ Invalid channel: ${opts.channel}`));
        console.error(chalk.dim(`  Valid channels: ${[...validChannels].join(", ")}`));
        throw new CommandError("", 1);
      }
      const channel = opts.channel as UpdateChannel | undefined;

      try {
        if (opts.check) {
          const result = await checkForUpdates({
            deployDir: opts.deployDir,
            checkOnly: true,
            channel,
            onProgress,
            signal: signal,
          });

          spinner.stop();

          if (result.error) {
            console.error(chalk.red(`\n✘ ${result.error}`));
            throw new CommandError("", 1);
          }

          if (result.available) {
            console.log(chalk.green("\n✔ Update available"));
            console.log(chalk.dim(`  Image: ${result.currentImage}`));

            // Display change intelligence report
            if (result.intelligence && result.currentVersion && result.targetVersion) {
              console.log("");
              console.log(formatIntelligenceReport(
                result.intelligence,
                result.currentVersion,
                result.targetVersion,
              ));
            }

            console.log(chalk.dim("\n  Run: clawhq update --passphrase <passphrase> to apply"));
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
            channel,
            dryRun: opts.dryRun,
            onProgress,
            signal: signal,
          });

          spinner.stop();

          if (result.success) {
            console.log(chalk.green("\n✔ Update applied successfully"));
            if (result.backupId) {
              console.log(chalk.dim(`  Pre-update backup: ${result.backupId}`));
            }
            if (result.migrationsApplied) {
              console.log(chalk.dim(`  Config migrations applied: ${result.migrationsApplied}`));
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

      const { signal, cleanup } = createCommandScope();

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
            signal: signal,
          });

          if (!result.success && !signal.aborted) {
            console.error(chalk.red(`\n✘ ${result.error}`));
            throw new CommandError("", 1);
          }
        } else {
          const result = await streamLogs({
            deployDir: opts.deployDir,
            follow: false,
            lines: lineCount,
            signal: signal,
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
      } finally {
        cleanup();
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

      const { signal, cleanup } = createCommandScope();

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

      try {
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
          signal,
          onEvent,
        });

        if (opts.json) {
          console.log(formatMonitorStateJson(state));
        } else {
          console.log(formatMonitorStateTable(state));
        }
      } finally {
        cleanup();
      }
    });

  const session = program
    .command("session")
    .description("Inspect and recover OpenClaw conversation sessions");

  session
    .command("list")
    .description("List sessions inside the running container, flagging any runaway tool-call loops")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const { signal, cleanup } = createCommandScope();
      try {
        const sessions = await listSessions(undefined, signal);
        if (opts.json) {
          console.log(JSON.stringify(sessions, null, 2));
          return;
        }
        if (sessions.length === 0) {
          console.log(chalk.dim("No sessions found (container may be stopped)."));
          return;
        }
        console.log(chalk.bold(`\n${sessions.length} session(s):\n`));
        for (const s of sessions) {
          const sizeMb = (s.sizeBytes / 1024 / 1024).toFixed(2);
          const flag = s.flags.length > 0
            ? chalk.red(` ⚠ ${s.flags.join(",")}`)
            : chalk.green(" ✓");
          const key = s.indexKey ? chalk.dim(` [${s.indexKey}]`) : "";
          console.log(`  ${s.id.slice(0, 8)}  ${s.messageCount.toString().padStart(6)} msgs  ${sizeMb.padStart(8)} MB  ${s.mtime}${key}${flag}`);
        }
        const runaway = sessions.filter((s) => s.flags.length > 0);
        if (runaway.length > 0) {
          console.log("");
          console.log(chalk.yellow(`  ${runaway.length} runaway session(s). Recover with: clawhq session archive <id>`));
        }
      } finally {
        cleanup();
      }
    });

  session
    .command("archive <sessionId>")
    .description("Archive a session, strip it from sessions.json, and restart the container")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--no-restart", "Do not restart the container after archiving")
    .action(async (sessionId: string, opts: { deployDir: string; restart: boolean }) => {
      ensureInstalled(opts.deployDir);
      const { signal, cleanup } = createCommandScope();
      const spinner = ora(`Archiving session ${sessionId.slice(0, 8)}…`);
      spinner.start();
      try {
        const result = await archiveSession(sessionId, opts.deployDir, {
          restart: opts.restart,
          signal,
        });
        spinner.stop();
        if (!result.success) {
          console.error(chalk.red(`✘ ${result.message}`));
          throw new CommandError("", 1);
        }
        console.log(chalk.green(`✔ ${result.message}`));
        if (result.archivedFiles.length > 0) {
          console.log(chalk.dim(`  Archived: ${result.archivedFiles.join(", ")}`));
        }
      } catch (error) {
        spinner.stop();
        if (error instanceof CommandError) throw error;
        console.error(renderError(error));
        throw new CommandError("", 1);
      } finally {
        cleanup();
      }
    });

  const ops = program.command("ops").description("Operational automation — deploy and manage systemd timers");

  ops
    .command("install")
    .description("Deploy generated scripts as systemd timers/services")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .action(async (opts: { deployDir: string }) => {
      ensureInstalled(opts.deployDir);

      const { signal, cleanup } = createCommandScope();

      const spinner = ora("Installing ops automation…");
      spinner.start();

      try {
        const result = await installOpsAutomation({
          deployDir: opts.deployDir,
          signal: signal,
        });

        spinner.stop();

        if (!result.success) {
          console.error(chalk.red(`\n✘ ${result.error}`));
          throw new CommandError("", 1);
        }

        console.log(chalk.green("\n✔ Ops automation installed"));
        console.log(chalk.dim(`  Installed: ${result.installed.join(", ")}`));
        console.log(chalk.dim(`  Enabled:   ${result.enabled.join(", ")}`));
        console.log(chalk.dim("\n  Check status: systemctl list-timers 'clawhq-*'"));
      } catch (error) {
        if (error instanceof CommandError) throw error;
        console.error(renderError(error));
        throw new CommandError("", 1);
      } finally {
        spinner.stop();
        cleanup();
      }
    });
}

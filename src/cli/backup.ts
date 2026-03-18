/**
 * `clawhq backup` and `clawhq update` commands.
 */

import { resolve } from "node:path";

import chalk from "chalk";
import { Command } from "commander";

import { createBackup } from "../operate/backup/backup.js";
import { formatBackupTable, listBackups } from "../operate/backup/list.js";
import { restoreBackup } from "../operate/backup/restore.js";
import { formatStepResult } from "../build/launcher/format.js";
import { formatCheckResult, runUpdate } from "../operate/updater/update.js";

import { spinner, status } from "./ui.js";

/**
 * Register backup and update commands on the program.
 */
export function createBackupCommands(program: Command): void {
  const backupCmd = program
    .command("backup")
    .description("Encrypted backup and restore");

  backupCmd
    .command("create", { isDefault: true })
    .description("Create an encrypted backup of agent state")
    .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
    .option("--backup-dir <path>", "Backup storage directory", "~/.clawhq/backups")
    .option("--gpg-recipient <id>", "GPG recipient (key ID or email)")
    .option("--secrets-only", "Back up only .env and credential files")
    .action(async (opts: {
      home: string;
      backupDir: string;
      gpgRecipient?: string;
      secretsOnly?: boolean;
    }) => {
      const homePath = opts.home.replace(/^~/, process.env.HOME ?? "~");
      const backupDir = opts.backupDir.replace(/^~/, process.env.HOME ?? "~");

      if (!opts.gpgRecipient) {
        console.error("Error: --gpg-recipient is required for encryption.");
        process.exitCode = 1;
        return;
      }

      const type = opts.secretsOnly ? "secrets-only" : "full";
      const backupSpinner = spinner(`${chalk.magenta("Operate")} Creating ${type} backup...`);
      backupSpinner.start();

      try {
        const result = await createBackup({
          openclawHome: homePath,
          backupDir,
          gpgRecipient: opts.gpgRecipient,
          secretsOnly: opts.secretsOnly,
        });

        backupSpinner.succeed(`${chalk.magenta("Operate")} ${status.pass} Backup created: ${result.backupId}`);
        console.log(`  Files: ${result.manifest.files.length}`);
        console.log(`  Archive: ${result.archivePath}`);
      } catch (err: unknown) {
        backupSpinner.fail(`${chalk.magenta("Operate")} ${status.fail} Backup failed`);
        console.error(
          err instanceof Error ? err.message : String(err),
        );
        process.exitCode = 1;
      }
    });

  backupCmd
    .command("list")
    .description("List available backups with IDs and timestamps")
    .option("--backup-dir <path>", "Backup storage directory", "~/.clawhq/backups")
    .option("--json", "Output as JSON")
    .action(async (opts: { backupDir: string; json?: boolean }) => {
      const backupDir = opts.backupDir.replace(/^~/, process.env.HOME ?? "~");

      try {
        const backups = await listBackups(backupDir);

        if (opts.json) {
          console.log(JSON.stringify(backups, null, 2));
        } else {
          console.log(formatBackupTable(backups));
        }
      } catch (err: unknown) {
        console.error(
          `Failed to list backups: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    });

  backupCmd
    .command("restore <id>")
    .description("Restore from an encrypted backup")
    .option("--home <path>", "OpenClaw home directory to restore into", "~/.openclaw")
    .option("--backup-dir <path>", "Backup storage directory", "~/.clawhq/backups")
    .action(async (id: string, opts: { home: string; backupDir: string }) => {
      const homePath = opts.home.replace(/^~/, process.env.HOME ?? "~");
      const backupDir = opts.backupDir.replace(/^~/, process.env.HOME ?? "~");

      const restoreSpinner = spinner(`${chalk.magenta("Operate")} Restoring backup ${id}...`);
      restoreSpinner.start();

      try {
        const result = await restoreBackup({
          backupId: id,
          backupDir,
          openclawHome: homePath,
        });

        if (result.doctorPassed) {
          restoreSpinner.succeed(`${chalk.magenta("Operate")} ${status.pass} Backup restored: ${result.backupId}`);
        } else {
          restoreSpinner.warn(`${chalk.magenta("Operate")} ${status.warn} Backup restored with warnings`);
        }
        console.log(`  Files restored: ${result.filesRestored}`);
        console.log(`  Integrity: ${result.integrityPassed ? "PASS" : "FAIL"}`);
        console.log(`  Doctor: ${result.doctorPassed ? "PASS" : "FAIL"} (${result.doctorChecks.pass} passed, ${result.doctorChecks.warn} warnings, ${result.doctorChecks.fail} failed)`);

        if (!result.doctorPassed) {
          console.log("");
          console.log("Run `clawhq doctor` for detailed diagnostics.");
        }
      } catch (err: unknown) {
        restoreSpinner.fail(`${chalk.magenta("Operate")} ${status.fail} Restore failed`);
        console.error(
          err instanceof Error ? err.message : String(err),
        );
        process.exitCode = 1;
      }
    });

  program
    .command("update")
    .description("Safe upstream OpenClaw update with pre-update snapshot and rollback")
    .option("--check", "Show what would change without updating")
    .option("--force", "Skip confirmation prompt")
    .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
    .option("--context <path>", "OpenClaw source directory", ".")
    .option("--dockerfile <path>", "Dockerfile path (relative to context)")
    .option("--base-tag <tag>", "Stage 1 base image tag", "openclaw:local")
    .option("--tag <tag>", "Stage 2 final image tag", "openclaw:custom")
    .option("--manifest-dir <path>", "Build manifest directory", ".")
    .option("--compose <path>", "Path to docker-compose.yml")
    .option("--env <path>", "Path to .env file")
    .option("--gpg-recipient <id>", "GPG recipient for pre-update snapshot")
    .option("--backup-dir <path>", "Backup storage directory", "~/.clawhq/backups")
    .option("--health-timeout <ms>", "Health poll timeout in ms", "60000")
    .option("--gateway-host <host>", "Gateway host", "127.0.0.1")
    .option("--gateway-port <port>", "Gateway port", "18789")
    .option("--providers <list>", "Comma-separated cloud providers for firewall allowlist")
    .option("--bridge <iface>", "Docker bridge interface for firewall", "docker0")
    .option("--repo <owner/repo>", "GitHub repo for release checks", "openclaw/openclaw")
    .action(async (opts: {
      check?: boolean;
      force?: boolean;
      home: string;
      context: string;
      dockerfile?: string;
      baseTag: string;
      tag: string;
      manifestDir: string;
      compose?: string;
      env?: string;
      gpgRecipient?: string;
      backupDir: string;
      healthTimeout: string;
      gatewayHost: string;
      gatewayPort: string;
      providers?: string;
      bridge: string;
      repo: string;
    }) => {
      // --check mode: show what would change and exit
      if (opts.check) {
        try {
          const output = await formatCheckResult({
            repo: opts.repo,
            finalTag: opts.tag,
          });
          console.log(output);
        } catch (err: unknown) {
          console.error(
            `Update check failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exitCode = 1;
        }
        return;
      }

      const updateSpinner = spinner(`${chalk.magenta("Operate")} Running update...`);
      updateSpinner.start();

      const result = await runUpdate({
        openclawHome: opts.home.replace(/^~/, process.env.HOME ?? "~"),
        composePath: opts.compose,
        envPath: opts.env?.replace(/^~/, process.env.HOME ?? "~"),
        context: resolve(opts.context),
        dockerfile: opts.dockerfile,
        baseTag: opts.baseTag,
        finalTag: opts.tag,
        manifestDir: resolve(opts.manifestDir),
        gpgRecipient: opts.gpgRecipient,
        backupDir: opts.backupDir.replace(/^~/, process.env.HOME ?? "~"),
        healthTimeoutMs: parseInt(opts.healthTimeout, 10),
        gatewayHost: opts.gatewayHost,
        gatewayPort: parseInt(opts.gatewayPort, 10),
        enabledProviders: opts.providers?.split(",").map((p) => p.trim()),
        bridgeInterface: opts.bridge,
        force: opts.force,
        repo: opts.repo,
      });

      if (result.success) {
        updateSpinner.succeed(`${chalk.magenta("Operate")} ${status.pass} Update complete`);
      } else if (result.rolledBack) {
        updateSpinner.fail(`${chalk.magenta("Operate")} ${status.fail} Update failed — rolled back`);
      } else {
        updateSpinner.fail(`${chalk.magenta("Operate")} ${status.fail} Update failed`);
      }

      for (let i = 0; i < result.steps.length; i++) {
        console.log(formatStepResult(i + 1, result.steps.length, result.steps[i]));
      }

      console.log("");

      if (result.rolledBack) {
        console.log("Update failed — rolled back to previous version.");
        if (result.snapshotId) {
          console.log(`Pre-update snapshot: ${result.snapshotId}`);
        }
        process.exitCode = 1;
      } else if (result.success) {
        console.log(`Update completed: ${result.previousVersion} -> ${result.newVersion}`);
        if (result.snapshotId) {
          console.log(`Pre-update snapshot: ${result.snapshotId}`);
        }
      } else {
        console.log("Update failed.");
        process.exitCode = 1;
      }
    });
}

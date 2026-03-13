#!/usr/bin/env node

import { createRequire } from "node:module";
import { resolve } from "node:path";

import { Command } from "commander";

import { createBackup } from "../backup/backup.js";
import { formatBackupTable, listBackups } from "../backup/list.js";
import { restoreBackup } from "../backup/restore.js";
import { deployDown, deployRestart, deployUp } from "../deploy/deploy.js";
import { formatStepResult, formatSummary } from "../deploy/format.js";
import {
  detectStage1Changes,
  formatDuration,
  formatSize,
  generateManifest,
  readManifest as readBuildManifest,
  readStage1Hash,
  twoStageBuild,
  verifyAgainstManifest,
  writeManifest as writeBuildManifest,
  writeStage1Hash,
} from "../docker/build.js";
import { DockerClient } from "../docker/client.js";
import { runFixes } from "../doctor/fix.js";
import { formatJson, formatTable, runChecks } from "../doctor/runner.js";
import type { DoctorContext } from "../doctor/types.js";
import { formatCredTable, runProbesFromFile } from "../security/credentials/index.js";
import { collectStatus } from "../status/collector.js";
import { formatDashboard, formatJson as formatStatusJson } from "../status/format.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string; description: string };

const program = new Command();

program
  .name("clawhq")
  .description(pkg.description)
  .version(pkg.version, "-v, --version", "Print version");

// Version subcommand
program
  .command("version")
  .description("Print version info")
  .action(() => {
    console.log(`clawhq v${pkg.version}`);
  });

// Plan phase
program.command("init").description("Initialize a new agent deployment");
program.command("template").description("Manage agent templates");

// Build phase
program
  .command("build")
  .description("Build agent container image (two-stage Docker build)")
  .option("--context <path>", "OpenClaw source directory", ".")
  .option("--dockerfile <path>", "Dockerfile path (relative to context)")
  .option("--base-tag <tag>", "Stage 1 base image tag", "openclaw:local")
  .option("--tag <tag>", "Stage 2 final image tag", "openclaw:custom")
  .option("--stage2-only", "Skip Stage 1 base image rebuild")
  .option("--verify", "Compare current images against build manifest")
  .option("--manifest-dir <path>", "Directory for build manifest", ".")
  .action(async (opts: {
    context: string;
    dockerfile?: string;
    baseTag: string;
    tag: string;
    stage2Only?: boolean;
    verify?: boolean;
    manifestDir: string;
  }) => {
    const client = new DockerClient();
    const contextPath = resolve(opts.context);
    const manifestDir = resolve(opts.manifestDir);

    // --verify mode: compare images against manifest and exit
    if (opts.verify) {
      const manifest = await readBuildManifest(manifestDir);
      if (!manifest) {
        console.error("No build manifest found. Run `clawhq build` first.");
        process.exitCode = 1;
        return;
      }
      console.log("Verifying images against build manifest...");
      const result = await verifyAgainstManifest(client, manifest);
      if (result.match) {
        console.log("All images match the build manifest.");
      } else {
        console.log(`Drift detected (${result.drifts.length} difference${result.drifts.length > 1 ? "s" : ""}):`);
        for (const drift of result.drifts) {
          console.log(`  Stage ${drift.stage} ${drift.field}: expected ${drift.expected}, got ${drift.actual}`);
        }
        process.exitCode = 1;
      }
      return;
    }

    // Detect Stage 1 changes for smart skipping
    let skipStage1 = opts.stage2Only ?? false;
    if (!skipStage1) {
      const lastHash = await readStage1Hash(manifestDir);
      const detection = await detectStage1Changes(contextPath, {
        dockerfile: opts.dockerfile,
        lastInputHash: lastHash ?? undefined,
      });
      if (!detection.changed && (await client.imageExists(opts.baseTag))) {
        console.log("Stage 1: No changes detected, skipping base image rebuild.");
        skipStage1 = true;
      }
    }

    if (opts.stage2Only) {
      console.log("Stage 1: Skipped (--stage2-only)");
    }

    // Run the build
    console.log(`Building from ${contextPath}...`);
    const result = await twoStageBuild(client, {
      context: contextPath,
      baseTag: opts.baseTag,
      finalTag: opts.tag,
      dockerfile: opts.dockerfile,
      skipStage1,
    });

    // Display results per stage
    if (result.stage1) {
      console.log(`Stage 1: ${result.stage1.imageTag} built in ${formatDuration(result.stage1.durationMs)}`);
    }
    console.log(`Stage 2: ${result.stage2.imageTag} built in ${formatDuration(result.stage2.durationMs)}`);
    console.log(`Total build time: ${formatDuration(result.totalDurationMs)}`);

    // Generate and write build manifest
    const manifest = await generateManifest(client, {
      context: contextPath,
      baseTag: opts.baseTag,
      finalTag: opts.tag,
      dockerfile: opts.dockerfile,
      stage1Built: result.stage1 !== null,
    });
    const manifestPath = await writeBuildManifest(manifest, manifestDir);
    console.log(`Build manifest: ${manifestPath}`);

    // Print image sizes from manifest
    if (manifest.stage1) {
      console.log(`  Stage 1: ${formatSize(manifest.stage1.size)} (${manifest.stage1.layers.length} layers)`);
    }
    console.log(`  Stage 2: ${formatSize(manifest.stage2.size)} (${manifest.stage2.layers.length} layers)`);

    // Save Stage 1 input hash for change detection
    const detection = await detectStage1Changes(contextPath, { dockerfile: opts.dockerfile });
    await writeStage1Hash(manifestDir, detection.inputHash);
  });

// Secure phase
program.command("scan").description("Scan for PII and leaked secrets");
program
  .command("creds")
  .description("Check credential health")
  .option("--env <path>", "Path to .env file", "~/.openclaw/.env")
  .option("--json", "Output results as JSON")
  .action(async (opts: { env: string; json?: boolean }) => {
    const envPath = opts.env.replace(/^~/, process.env.HOME ?? "~");

    try {
      const report = await runProbesFromFile(envPath);

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatCredTable(report));
      }

      const hasFailures = report.counts.failing > 0 || report.counts.expired > 0;
      if (hasFailures) {
        process.exitCode = 1;
      }
    } catch (err: unknown) {
      console.error(
        `Cannot read .env file at ${envPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exitCode = 1;
    }
  });
program.command("audit").description("View audit logs");

// Deploy phase
program
  .command("up")
  .description("Deploy agent container with pre-flight checks, firewall, and health verification")
  .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
  .option("--config <path>", "Path to openclaw.json", "~/.openclaw/openclaw.json")
  .option("--compose <path>", "Path to docker-compose.yml")
  .option("--env <path>", "Path to .env file")
  .option("--image-tag <tag>", "Expected agent image tag", "openclaw:custom")
  .option("--base-tag <tag>", "Expected base image tag", "openclaw:local")
  .option("--health-timeout <ms>", "Health poll timeout in ms", "60000")
  .option("--gateway-host <host>", "Gateway host", "127.0.0.1")
  .option("--gateway-port <port>", "Gateway port", "18789")
  .option("--providers <list>", "Comma-separated cloud providers for firewall allowlist")
  .option("--bridge <iface>", "Docker bridge interface for firewall", "docker0")
  .action(async (opts: {
    home: string;
    config: string;
    compose?: string;
    env?: string;
    imageTag: string;
    baseTag: string;
    healthTimeout: string;
    gatewayHost: string;
    gatewayPort: string;
    providers?: string;
    bridge: string;
  }) => {
    const homePath = opts.home.replace(/^~/, process.env.HOME ?? "~");
    const configPath = opts.config.replace(/^~/, process.env.HOME ?? "~");
    const envPath = opts.env?.replace(/^~/, process.env.HOME ?? "~");

    console.log("Starting deployment...");
    console.log("");

    const result = await deployUp({
      openclawHome: homePath,
      configPath,
      composePath: opts.compose,
      envPath,
      imageTag: opts.imageTag,
      baseTag: opts.baseTag,
      healthTimeoutMs: parseInt(opts.healthTimeout, 10),
      gatewayHost: opts.gatewayHost,
      gatewayPort: parseInt(opts.gatewayPort, 10),
      enabledProviders: opts.providers?.split(",").map((p) => p.trim()),
      bridgeInterface: opts.bridge,
    });

    for (let i = 0; i < result.steps.length; i++) {
      console.log(formatStepResult(i + 1, result.steps.length, result.steps[i]));
    }

    console.log(formatSummary("Deployment", result.steps, result.success));

    if (result.containerId) {
      console.log(`Container: ${result.containerId}`);
    }

    if (!result.success) {
      // Show pre-flight details if that was the failure
      const preflightStep = result.steps.find((s) => s.name === "Pre-flight checks");
      if (preflightStep?.status === "failed") {
        console.log("");
        console.log("Run `clawhq doctor` for detailed diagnostics.");
      }
      process.exitCode = 1;
    }
  });

program
  .command("down")
  .description("Stop agent container gracefully, preserving workspace state")
  .option("--compose <path>", "Path to docker-compose.yml")
  .action(async (opts: { compose?: string }) => {
    console.log("Stopping deployment...");
    console.log("");

    const result = await deployDown({ composePath: opts.compose });

    for (let i = 0; i < result.steps.length; i++) {
      console.log(formatStepResult(i + 1, result.steps.length, result.steps[i]));
    }

    console.log(formatSummary("Shutdown", result.steps, result.success));

    if (!result.success) {
      process.exitCode = 1;
    }
  });

program
  .command("restart")
  .description("Restart agent container with firewall reapply and health re-verify")
  .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
  .option("--compose <path>", "Path to docker-compose.yml")
  .option("--health-timeout <ms>", "Health poll timeout in ms", "60000")
  .option("--gateway-host <host>", "Gateway host", "127.0.0.1")
  .option("--gateway-port <port>", "Gateway port", "18789")
  .option("--providers <list>", "Comma-separated cloud providers for firewall allowlist")
  .option("--bridge <iface>", "Docker bridge interface for firewall", "docker0")
  .action(async (opts: {
    home: string;
    compose?: string;
    healthTimeout: string;
    gatewayHost: string;
    gatewayPort: string;
    providers?: string;
    bridge: string;
  }) => {
    console.log("Restarting deployment...");
    console.log("");

    const result = await deployRestart({
      openclawHome: opts.home.replace(/^~/, process.env.HOME ?? "~"),
      composePath: opts.compose,
      healthTimeoutMs: parseInt(opts.healthTimeout, 10),
      gatewayHost: opts.gatewayHost,
      gatewayPort: parseInt(opts.gatewayPort, 10),
      enabledProviders: opts.providers?.split(",").map((p) => p.trim()),
      bridgeInterface: opts.bridge,
    });

    for (let i = 0; i < result.steps.length; i++) {
      console.log(formatStepResult(i + 1, result.steps.length, result.steps[i]));
    }

    console.log(formatSummary("Restart", result.steps, result.success));

    if (result.containerId) {
      console.log(`Container: ${result.containerId}`);
    }

    if (!result.success) {
      process.exitCode = 1;
    }
  });

program.command("connect").description("Connect messaging channel");

// Operate phase
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
      if (opts.json) {
        console.log(formatStatusJson(report));
      } else {
        console.log(formatDashboard(report));
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

// Backup command with subcommands
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

    try {
      const result = await createBackup({
        openclawHome: homePath,
        backupDir,
        gpgRecipient: opts.gpgRecipient,
        secretsOnly: opts.secretsOnly,
      });

      const type = opts.secretsOnly ? "secrets-only" : "full";
      console.log(`Backup created: ${result.backupId} (${type})`);
      console.log(`  Files: ${result.manifest.files.length}`);
      console.log(`  Archive: ${result.archivePath}`);
    } catch (err: unknown) {
      console.error(
        `Backup failed: ${err instanceof Error ? err.message : String(err)}`,
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

    try {
      const result = await restoreBackup({
        backupId: id,
        backupDir,
        openclawHome: homePath,
      });

      console.log(`Restored backup: ${result.backupId}`);
      console.log(`  Files restored: ${result.filesRestored}`);
      console.log(`  Integrity: ${result.integrityPassed ? "PASS" : "FAIL"}`);
      console.log(`  Doctor: ${result.doctorPassed ? "PASS" : "FAIL"} (${result.doctorChecks.pass} passed, ${result.doctorChecks.warn} warnings, ${result.doctorChecks.fail} failed)`);

      if (!result.doctorPassed) {
        console.log("");
        console.log("Run `clawhq doctor` for detailed diagnostics.");
      }
    } catch (err: unknown) {
      console.error(
        `Restore failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exitCode = 1;
    }
  });

program.command("update").description("Update OpenClaw upstream");
program.command("logs").description("Stream agent logs");

// Evolve phase
program.command("evolve").description("Manage agent capabilities");

// Decommission phase
program.command("export").description("Export portable agent bundle");
program.command("destroy").description("Verified agent destruction");

program.parse();

if (!process.argv.slice(2).length) {
  program.outputHelp();
}

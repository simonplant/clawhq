#!/usr/bin/env node

import { createRequire } from "node:module";
import { resolve } from "node:path";

import { Command } from "commander";

import { createBackup } from "../backup/backup.js";
import { formatBackupTable, listBackups } from "../backup/list.js";
import { restoreBackup } from "../backup/restore.js";
import type { ChannelSetupFlow } from "../connect/index.js";
import { formatTestResult, telegramFlow, whatsappFlow } from "../connect/index.js";
import { deployDown, deployRestart, deployUp } from "../deploy/deploy.js";
import { formatStepResult, formatSummary } from "../deploy/format.js";
import { destroy, dryRun } from "../destroy/destroy.js";
import type { DestroyStep } from "../destroy/types.js";
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
import { createExport } from "../export/export.js";
import { createReadlineIO, runWizard } from "../init/index.js";
import {
  addIntegration,
  checkCronDependencies,
  cleanIdentityReferences,
  findCategory,
  formatIntegrationList,
  INTEGRATION_CATEGORIES,
  IntegrateError,
  listIntegrations,
  removeIntegration,
  swapIntegration,
  updateFirewallAllowlist,
} from "../integrate/index.js";
import type { IntegrateContext } from "../integrate/index.js";
import type { LogCategory } from "../logs/index.js";
import {
  formatCronHistory,
  readCronHistory,
  streamContainerLogs,
} from "../logs/index.js";
import type { RepairConfig, RepairContext } from "../repair/index.js";
import {
  DEFAULT_REPAIR_CONFIG,
  formatRepairJson,
  formatRepairReport,
  readRepairLog,
  runRepair,
} from "../repair/index.js";
import { formatCredTable, runProbesFromFile } from "../security/credentials/index.js";
import { formatScanTable, scanFiles, scanGitHistory } from "../security/secrets/scanner.js";
import {
  activateSkill,
  applySkillUpdate,
  formatSkillList,
  formatSkillSummary,
  formatVetResult,
  loadRegistry,
  removeSkillOp,
  resolveSource,
  stageSkillInstall,
  stageSkillUpdate,
} from "../skill/index.js";
import type { SkillContext } from "../skill/index.js";
import { SkillError } from "../skill/types.js";
import { runSmokeTest } from "../smoke/index.js";
import { collectStatus } from "../status/collector.js";
import { formatDashboard, formatJson as formatStatusJson } from "../status/format.js";
import {
  formatPreview,
  formatTemplateList as formatYamlTemplateList,
  generatePreview,
  loadBuiltInTemplates,
} from "../templates/index.js";
import { formatCheckResult, runUpdate } from "../update/update.js";

import { createFleetCommand } from "./fleet.js";
import { createProviderCommand } from "./provider.js";
import { createSecretsCommand } from "./secrets.js";

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
program
  .command("init")
  .description("Initialize a new agent deployment")
  .option("--guided", "Run interactive guided questionnaire")
  .option("--output <path>", "Output directory for generated config", "~/.openclaw")
  .action(async (opts: { guided?: boolean; output: string }) => {
    const outputDir = opts.output.replace(/^~/, process.env.HOME ?? "~");

    if (!opts.guided) {
      // Default to guided mode when no other mode is specified
      console.log("Hint: Use `clawhq init --guided` for the interactive setup wizard.");
      console.log("      Use `clawhq init --smart` for AI-powered config inference (coming soon).");
      console.log("");
      console.log("Starting guided setup...");
      console.log("");
    }

    const { io, close } = createReadlineIO();
    try {
      const result = await runWizard(io, outputDir);

      if (result.writeResult.errors.length > 0) {
        process.exitCode = 1;
      }
    } finally {
      close();
    }
  });
const templateCmd = program
  .command("template")
  .description("Manage agent templates");

templateCmd
  .command("list", { isDefault: true })
  .description("List available templates")
  .action(async () => {
    const results = await loadBuiltInTemplates();
    const templates = new Map<string, import("../templates/index.js").Template>();
    for (const [id, result] of results) {
      if (result.template) {
        templates.set(id, result.template);
      }
    }
    console.log("Available templates:\n");
    console.log(formatYamlTemplateList(templates));
  });

templateCmd
  .command("preview <id>")
  .description("Preview a template's operational profile")
  .action(async (id: string) => {
    const results = await loadBuiltInTemplates();
    const result = results.get(id);

    if (!result || !result.template) {
      console.error(`Template "${id}" not found.`);
      console.error("Available templates:");
      for (const [tid] of results) {
        if (tid !== "_error") {
          console.error(`  - ${tid}`);
        }
      }
      process.exitCode = 1;
      return;
    }

    const preview = generatePreview(result.template);
    console.log(formatPreview(preview));
  });

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
program
  .command("scan")
  .description("Scan for PII and leaked secrets")
  .option("--path <path>", "Directory to scan", "~/.openclaw/workspace")
  .option("--history", "Include git history in scan")
  .option("--json", "Output results as JSON")
  .action(async (opts: { path: string; history?: boolean; json?: boolean }) => {
    const scanPath = opts.path.replace(/^~/, process.env.HOME ?? "~");
    const resolvedPath = resolve(scanPath);

    try {
      const result = await scanFiles(resolvedPath);
      let historyMatches: Awaited<ReturnType<typeof scanGitHistory>> = [];

      if (opts.history) {
        historyMatches = await scanGitHistory(resolvedPath);
      }

      if (opts.json) {
        console.log(JSON.stringify({
          ...result,
          historyMatches,
          totalIssues: result.matches.length + historyMatches.length,
        }, null, 2));
      } else {
        console.log(formatScanTable(result, historyMatches));
      }

      if (result.matches.length + historyMatches.length > 0) {
        process.exitCode = 1;
      }
    } catch (err: unknown) {
      console.error(
        `Scan failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exitCode = 1;
    }
  });
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
program.addCommand(createSecretsCommand());
program.addCommand(createProviderCommand());
program.addCommand(createFleetCommand());
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

// Smoke test — standalone post-deploy verification
program
  .command("smoke")
  .description("Run post-deploy smoke test to verify agent is working")
  .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
  .option("--config <path>", "Path to openclaw.json", "~/.openclaw/openclaw.json")
  .option("--gateway-host <host>", "Gateway host", "127.0.0.1")
  .option("--gateway-port <port>", "Gateway port", "18789")
  .option("--timeout <ms>", "Response timeout in ms", "30000")
  .option("--json", "Output results as JSON")
  .action(async (opts: {
    home: string;
    config: string;
    gatewayHost: string;
    gatewayPort: string;
    timeout: string;
    json?: boolean;
  }) => {
    const homePath = opts.home.replace(/^~/, process.env.HOME ?? "~");
    const configPath = opts.config.replace(/^~/, process.env.HOME ?? "~");

    const result = await runSmokeTest({
      openclawHome: homePath,
      configPath,
      gatewayHost: opts.gatewayHost,
      gatewayPort: parseInt(opts.gatewayPort, 10),
      responseTimeoutMs: parseInt(opts.timeout, 10),
    });

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      // Table output matching doctor format
      const nameWidth = Math.max(5, ...result.checks.map((c) => c.name.length));
      const statusWidth = 6;

      console.log(`${"CHECK".padEnd(nameWidth)}  ${"STATUS".padEnd(statusWidth)}  MESSAGE`);
      console.log("-".repeat(nameWidth + statusWidth + nameWidth + 10));

      for (const check of result.checks) {
        const icon = check.status.toUpperCase();
        console.log(`${check.name.padEnd(nameWidth)}  ${icon.padEnd(statusWidth)}  ${check.message}`);
      }

      const passCount = result.checks.filter((c) => c.status === "pass").length;
      const failCount = result.checks.filter((c) => c.status === "fail").length;
      const skipCount = result.checks.filter((c) => c.status === "skip").length;

      console.log("");
      console.log(`${passCount} passed, ${failCount} failed, ${skipCount} skipped`);

      if (!result.passed) {
        console.log("");
        console.log("Smoke test failed. Run `clawhq doctor` for full diagnostics.");
      }
    }

    if (!result.passed) {
      process.exitCode = 1;
    }
  });

const connectCmd = program
  .command("connect")
  .description("Connect messaging channel")
  .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
  .option("--config <path>", "Path to openclaw.json", "~/.openclaw/openclaw.json")
  .option("--env <path>", "Path to .env file", "~/.openclaw/.env")
  .option("--test", "Test existing channel connection (bidirectional)");

const CHANNEL_FLOWS: Record<string, ChannelSetupFlow> = {
  telegram: telegramFlow,
  whatsapp: whatsappFlow,
};

async function runConnectAction(
  channelName: string,
  opts: { home: string; config: string; env: string; test?: boolean },
) {
  const homePath = opts.home.replace(/^~/, process.env.HOME ?? "~");
  const configPath = opts.config.replace(/^~/, process.env.HOME ?? "~");
  const envPath = opts.env.replace(/^~/, process.env.HOME ?? "~");
  const connectOpts = { openclawHome: homePath, configPath, envPath };

  const flow = CHANNEL_FLOWS[channelName];
  if (!flow) {
    console.error(`Unknown channel: ${channelName}`);
    console.error(`Supported channels: ${Object.keys(CHANNEL_FLOWS).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  if (opts.test) {
    console.log(`Testing ${channelName} connection...`);
    console.log("");
    const result = await flow.test(connectOpts);
    console.log(formatTestResult(result));
    if (!result.success) {
      process.exitCode = 1;
    }
    return;
  }

  // Interactive setup
  const { io, close } = createReadlineIO();
  try {
    const result = await flow.setup(io, connectOpts);
    if (!result.success) {
      process.exitCode = 1;
    }
  } finally {
    close();
  }
}

connectCmd
  .command("telegram")
  .description("Connect Telegram bot via BotFather token")
  .action(async () => {
    const parentOpts = connectCmd.opts() as { home: string; config: string; env: string; test?: boolean };
    await runConnectAction("telegram", parentOpts);
  });

connectCmd
  .command("whatsapp")
  .description("Connect WhatsApp Business API")
  .action(async () => {
    const parentOpts = connectCmd.opts() as { home: string; config: string; env: string; test?: boolean };
    await runConnectAction("whatsapp", parentOpts);
  });

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

// Repair command — health self-repair (auto-recovery)
program
  .command("repair")
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

    console.log("Starting update...");
    console.log("");

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

// Agent management
const agentCmd = program
  .command("agent")
  .description("Manage agents in the deployment");

agentCmd
  .command("add <id>")
  .description("Add a new agent to an existing deployment")
  .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
  .option("--config <path>", "Path to openclaw.json", "~/.openclaw/openclaw.json")
  .option("--channel <type>", "Channel type for binding (e.g. telegram)", "telegram")
  .option("--peer-id <id>", "Channel peer ID for routing")
  .action(async (
    agentId: string,
    opts: {
      home: string;
      config: string;
      channel: string;
      peerId?: string;
    },
  ) => {
    const { readFile, writeFile: writeFileFs, mkdir: mkdirFs } = await import("node:fs/promises");
    const { join } = await import("node:path");

    const homePath = opts.home.replace(/^~/, process.env.HOME ?? "~");
    const configPath = opts.config.replace(/^~/, process.env.HOME ?? "~");

    // Read existing openclaw.json
    let config: Record<string, unknown>;
    try {
      const raw = await readFile(configPath, "utf-8");
      config = JSON.parse(raw) as Record<string, unknown>;
    } catch (err: unknown) {
      console.error(`Cannot read ${configPath}: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
      return;
    }

    // Initialize agents section if not present
    const agents = (config["agents"] ?? {}) as Record<string, unknown>;
    const list = (agents["list"] ?? []) as Array<Record<string, unknown>>;
    const bindings = (agents["bindings"] ?? []) as Array<Record<string, unknown>>;

    // Check for duplicate
    if (list.some((a) => a["id"] === agentId)) {
      console.error(`Agent "${agentId}" already exists.`);
      process.exitCode = 1;
      return;
    }

    // If no default agent exists, make the first one default
    if (list.length === 0) {
      list.push({
        id: "default",
        default: true,
        workspace: "/home/node/.openclaw/workspace",
      });
    }

    // Create workspace for new agent
    const agentWorkspace = join(homePath, "agents", agentId, "agent", "workspace");
    await mkdirFs(agentWorkspace, { recursive: true });

    // Add new agent to list
    const containerWorkspace = `/home/node/.openclaw/agents/${agentId}/agent/workspace`;
    list.push({
      id: agentId,
      workspace: containerWorkspace,
    });

    // Add channel binding if peer ID provided
    if (opts.peerId) {
      bindings.push({
        agentId,
        match: {
          channel: opts.channel,
          peer: { kind: "direct", id: opts.peerId },
        },
      });
    }

    // Update config
    agents["list"] = list;
    agents["bindings"] = bindings;
    config["agents"] = agents;

    // Write updated config
    await writeFileFs(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

    // Generate basic identity files for the new agent
    const identityFiles: Record<string, string> = {
      "SOUL.md": `# SOUL.md — ${agentId}\n\n<!-- Define this agent's identity and values -->\n`,
      "USER.md": "# User Context\n\n<!-- Add details about yourself -->\n",
      "IDENTITY.md": `# IDENTITY.md\n\n**${agentId}** — an OpenClaw agent.\n`,
      "MEMORY.md": "# MEMORY.md\n\n## Active Situations\n\n## Lessons Learned\n\n## Patterns\n",
    };

    for (const [filename, content] of Object.entries(identityFiles)) {
      await writeFileFs(join(agentWorkspace, filename), content, "utf-8");
    }

    // Create memory directories
    for (const tier of ["memory/hot", "memory/warm", "memory/cold"]) {
      await mkdirFs(join(agentWorkspace, tier), { recursive: true });
    }

    console.log(`Agent "${agentId}" added.`);
    console.log(`  Workspace: ${agentWorkspace}`);
    console.log(`  Container path: ${containerWorkspace}`);
    if (opts.peerId) {
      console.log(`  Binding: ${opts.channel} peer ${opts.peerId}`);
    }
    console.log("");
    console.log("Next steps:");
    console.log(`  1. Edit ${join(agentWorkspace, "SOUL.md")} to define the agent's identity`);
    console.log("  2. Add a volume mount for the agent workspace to docker-compose.yml");
    if (!opts.peerId) {
      console.log("  3. Add a channel binding with --peer-id or edit openclaw.json");
    }
    console.log(`  ${opts.peerId ? "3" : "4"}. Run \`clawhq restart\` to apply changes`);
  });

agentCmd
  .command("list")
  .description("List configured agents")
  .option("--config <path>", "Path to openclaw.json", "~/.openclaw/openclaw.json")
  .action(async (opts: { config: string }) => {
    const { readFile } = await import("node:fs/promises");
    const configPath = opts.config.replace(/^~/, process.env.HOME ?? "~");

    try {
      const raw = await readFile(configPath, "utf-8");
      const config = JSON.parse(raw) as Record<string, unknown>;
      const agents = (config["agents"] ?? {}) as Record<string, unknown>;
      const list = (agents["list"] ?? []) as Array<Record<string, unknown>>;
      const bindings = (agents["bindings"] ?? []) as Array<Record<string, unknown>>;

      if (list.length === 0) {
        console.log("Single-agent deployment (no agents.list configured).");
        return;
      }

      console.log("Agents:");
      for (const agent of list) {
        const isDefault = agent["default"] ? " (default)" : "";
        const binding = bindings.find((b) => b["agentId"] === agent["id"]);
        const bindingStr = binding
          ? ` -> ${(binding["match"] as Record<string, unknown>)["channel"]}`
          : "";
        console.log(`  ${agent["id"]}${isDefault}${bindingStr}`);
        console.log(`    workspace: ${agent["workspace"]}`);
      }
    } catch (err: unknown) {
      console.error(`Cannot read config: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  });

// Evolve phase
program.command("evolve").description("Manage agent capabilities");

// Skill management (Evolve sub-feature)
const skillCmd = program
  .command("skill")
  .description("Manage agent skills — install, list, update, remove")
  .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
  .option("--clawhq-dir <path>", "ClawHQ data directory", "~/.clawhq");

function makeSkillCtx(opts: { home: string; clawhqDir: string }): SkillContext {
  return {
    openclawHome: opts.home.replace(/^~/, process.env.HOME ?? "~"),
    clawhqDir: opts.clawhqDir.replace(/^~/, process.env.HOME ?? "~"),
  };
}

skillCmd
  .command("list", { isDefault: true })
  .description("List installed skills with version, source, status, and last-used timestamp")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    const parentOpts = skillCmd.opts() as { home: string; clawhqDir: string };
    const ctx = makeSkillCtx(parentOpts);
    const registry = await loadRegistry(ctx);

    if (opts.json) {
      console.log(JSON.stringify(registry.skills, null, 2));
    } else {
      console.log(formatSkillList(registry.skills));
    }
  });

skillCmd
  .command("install <source>")
  .description("Install a skill from a local path, URL, or registry name")
  .option("--force", "Skip approval prompt")
  .action(async (source: string, opts: { force?: boolean }) => {
    const parentOpts = skillCmd.opts() as { home: string; clawhqDir: string };
    const ctx = makeSkillCtx(parentOpts);

    try {
      // Stage: fetch + vet
      console.log(`Fetching skill from ${source}...`);
      const { manifest, vetResult, stagingDir } = await stageSkillInstall(ctx, source);

      // Show summary and vet results
      console.log("");
      console.log(formatSkillSummary(
        manifest.name,
        manifest.version,
        manifest.description,
        manifest.files,
        manifest.requiresContainerDeps,
      ));
      console.log(formatVetResult(vetResult));
      console.log("");

      // Block on vetting failure
      if (!vetResult.passed) {
        console.error("Skill failed security vetting. Installation blocked.");
        const { rm: rmDir } = await import("node:fs/promises");
        await rmDir(stagingDir, { recursive: true, force: true });
        process.exitCode = 1;
        return;
      }

      // Approval gate
      if (!opts.force) {
        const { io, close } = createReadlineIO();
        try {
          const answer = await io.prompt("Install this skill? (yes/no): ");

          if (answer.toLowerCase() !== "yes" && answer.toLowerCase() !== "y") {
            console.log("Installation cancelled.");
            const { rm: rmDir } = await import("node:fs/promises");
            await rmDir(stagingDir, { recursive: true, force: true });
            return;
          }
        } finally {
          close();
        }
      }

      // Activate
      const resolved = resolveSource(source);
      const result = await activateSkill(ctx, manifest, stagingDir, resolved.source, resolved.uri);

      console.log(`Skill "${result.skill.name}" installed and activated.`);
      if (result.requiresRebuild) {
        console.log("");
        console.log("This skill requires container-level dependencies.");
        console.log("Run `clawhq build --stage2-only` to rebuild the agent image.");
      }
    } catch (err: unknown) {
      if (err instanceof SkillError) {
        console.error(`Error: ${err.message}`);
      } else {
        console.error(`Install failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      process.exitCode = 1;
    }
  });

skillCmd
  .command("remove <name>")
  .description("Remove an installed skill (rollback snapshot kept for 30 days)")
  .action(async (name: string) => {
    const parentOpts = skillCmd.opts() as { home: string; clawhqDir: string };
    const ctx = makeSkillCtx(parentOpts);

    try {
      const result = await removeSkillOp(ctx, name);

      console.log(`Skill "${name}" removed.`);
      console.log(`  Rollback snapshot: ${result.snapshotId}`);
      console.log("  Snapshot expires in 30 days.");
      console.log("");
      console.log("TOOLS.md updated.");
    } catch (err: unknown) {
      if (err instanceof SkillError) {
        console.error(`Error: ${err.message}`);
      } else {
        console.error(`Remove failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      process.exitCode = 1;
    }
  });

skillCmd
  .command("update <name>")
  .description("Update a skill — vets new version before replacing (old version kept as rollback)")
  .option("--source <path>", "New source path or URL (defaults to original source)")
  .option("--force", "Skip approval prompt")
  .action(async (name: string, opts: { source?: string; force?: boolean }) => {
    const parentOpts = skillCmd.opts() as { home: string; clawhqDir: string };
    const ctx = makeSkillCtx(parentOpts);

    try {
      console.log(`Fetching update for "${name}"...`);
      const { manifest, vetResult, stagingDir } = await stageSkillUpdate(ctx, name, opts.source);

      console.log("");
      console.log(formatSkillSummary(
        manifest.name,
        manifest.version,
        manifest.description,
        manifest.files,
        manifest.requiresContainerDeps,
      ));
      console.log(formatVetResult(vetResult));
      console.log("");

      if (!vetResult.passed) {
        console.error("New version failed security vetting. Update blocked.");
        const { rm: rmDir } = await import("node:fs/promises");
        await rmDir(stagingDir, { recursive: true, force: true });
        process.exitCode = 1;
        return;
      }

      if (!opts.force) {
        const { io, close } = createReadlineIO();
        try {
          const answer = await io.prompt("Apply this update? (yes/no): ");

          if (answer.toLowerCase() !== "yes" && answer.toLowerCase() !== "y") {
            console.log("Update cancelled.");
            const { rm: rmDir } = await import("node:fs/promises");
            await rmDir(stagingDir, { recursive: true, force: true });
            return;
          }
        } finally {
          close();
        }
      }

      const result = await applySkillUpdate(ctx, name, manifest, stagingDir);

      console.log(`Skill "${name}" updated: ${result.previousVersion} -> ${result.skill.version}`);
      console.log(`  Rollback snapshot: ${result.snapshotId}`);
      if (result.requiresRebuild) {
        console.log("");
        console.log("This skill requires container-level dependencies.");
        console.log("Run `clawhq build --stage2-only` to rebuild the agent image.");
      }
    } catch (err: unknown) {
      if (err instanceof SkillError) {
        console.error(`Error: ${err.message}`);
      } else {
        console.error(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      process.exitCode = 1;
    }
  });

// Integration management (Evolve sub-feature)
const integrateCmd = program
  .command("integrate")
  .description("Manage integrations — add, remove, swap, list")
  .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
  .option("--clawhq-dir <path>", "ClawHQ data directory", "~/.clawhq");

function makeIntegrateCtx(opts: { home: string; clawhqDir: string }): IntegrateContext {
  return {
    openclawHome: opts.home.replace(/^~/, process.env.HOME ?? "~"),
    clawhqDir: opts.clawhqDir.replace(/^~/, process.env.HOME ?? "~"),
  };
}

integrateCmd
  .command("list", { isDefault: true })
  .description("List all integrations with provider, status, credential health")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    const parentOpts = integrateCmd.opts() as { home: string; clawhqDir: string };
    const ctx = makeIntegrateCtx(parentOpts);

    try {
      const entries = await listIntegrations(ctx);

      if (opts.json) {
        console.log(JSON.stringify(entries, null, 2));
      } else {
        console.log(formatIntegrationList(entries));
      }
    } catch (err: unknown) {
      console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  });

integrateCmd
  .command("add <category>")
  .description("Add integration: walk through provider selection, credential setup, config generation")
  .option("--provider <name>", "Provider name (skip selection prompt)")
  .action(async (category: string, opts: { provider?: string }) => {
    const parentOpts = integrateCmd.opts() as { home: string; clawhqDir: string };
    const ctx = makeIntegrateCtx(parentOpts);

    try {
      const catDef = findCategory(category);
      if (!catDef) {
        const available = INTEGRATION_CATEGORIES.map((c) => c.category).join(", ");
        console.error(`Unknown category "${category}". Available: ${available}`);
        process.exitCode = 1;
        return;
      }

      // Provider selection
      let providerName = opts.provider;
      if (!providerName) {
        if (catDef.providers.length === 1) {
          providerName = catDef.providers[0].provider;
        } else {
          console.log(`Available providers for ${catDef.label}:`);
          for (let i = 0; i < catDef.providers.length; i++) {
            console.log(`  ${i + 1}. ${catDef.providers[i].label}`);
          }

          const { io, close } = createReadlineIO();
          try {
            const answer = await io.prompt(`Select provider (1-${catDef.providers.length})`, "1");
            const idx = parseInt(answer, 10) - 1;
            if (idx < 0 || idx >= catDef.providers.length) {
              console.error("Invalid selection.");
              process.exitCode = 1;
              return;
            }
            providerName = catDef.providers[idx].provider;
          } finally {
            close();
          }
        }
      }

      const provDef = catDef.providers.find((p) => p.provider === providerName);
      if (!provDef) {
        console.error(`Unknown provider "${providerName}" for category "${category}".`);
        process.exitCode = 1;
        return;
      }

      // Credential prompt
      const { io, close } = createReadlineIO();
      let credential: string;
      try {
        credential = await io.prompt(`${provDef.promptLabel}: `, "");
      } finally {
        close();
      }

      if (!credential) {
        console.error("Credential is required.");
        process.exitCode = 1;
        return;
      }

      // Validate credential live before completing setup
      let validated = false;
      console.log("Validating credential...");
      try {
        // Write credential to a temp env to validate it
        const { parseEnv, setEnvValue: setTmpEnvValue } = await import(
          "../security/secrets/env.js"
        );
        const envPath = resolve(ctx.openclawHome, ".env");
        let existingContent = "";
        try {
          const { readFile: rf } = await import("node:fs/promises");
          existingContent = await rf(envPath, "utf-8");
        } catch { /* no existing .env */ }
        const tmpEnv = parseEnv(existingContent);
        setTmpEnvValue(tmpEnv, provDef.envVar, credential);

        const { runProbes, DEFAULT_PROBES } = await import(
          "../security/credentials/index.js"
        );
        const report = await runProbes(tmpEnv, DEFAULT_PROBES);
        const selectedProvider = providerName ?? "";
        const probe = report.results.find(
          (r) => r.provider.toLowerCase() === selectedProvider.toLowerCase(),
        );
        if (probe && probe.status === "valid") {
          validated = true;
          console.log(`  Credential valid (${probe.message})`);
        } else if (probe && probe.status !== "missing") {
          console.log(`  Credential check: ${probe.status} — ${probe.message}`);
          console.log("  Proceeding with setup (credential may need additional configuration).");
        } else {
          console.log("  No built-in probe for this provider — skipping live validation.");
        }
      } catch {
        console.log("  Credential validation not available — proceeding.");
      }

      console.log(`Adding ${catDef.label} integration (${provDef.label})...`);
      const result = await addIntegration(ctx, category, providerName, credential, validated);

      console.log(`Integration "${category}" added (provider: ${provDef.label}).`);
      if (result.toolsInstalled.length > 0) {
        console.log(`  Tools: ${result.toolsInstalled.join(", ")}`);
      }
      if (result.egressDomainsAdded.length > 0) {
        console.log(`  Egress domains: ${result.egressDomainsAdded.join(", ")}`);
      }

      // Update egress firewall allowlist atomically
      if (result.egressDomainsAdded.length > 0) {
        const fwResult = await updateFirewallAllowlist(ctx);
        if (fwResult) {
          if (fwResult.success) {
            console.log(`  Firewall updated: ${fwResult.message}`);
          } else {
            console.log(`  Firewall update skipped: ${fwResult.message}`);
          }
        }
      }

      // Check cron dependencies
      const cronDeps = await checkCronDependencies(ctx, category);
      if (cronDeps.dependentJobs.length > 0) {
        console.log(`  Cron jobs using ${category}:`);
        for (const job of cronDeps.dependentJobs) {
          console.log(`    - ${job.id}`);
        }
      }

      // Run targeted doctor health check
      try {
        const doctorCtx: DoctorContext = {
          openclawHome: ctx.openclawHome,
          configPath: resolve(ctx.openclawHome, "openclaw.json"),
          envPath: resolve(ctx.openclawHome, ".env"),
        };
        const { runChecks: runDoctorChecks } = await import("../doctor/runner.js");
        const { firewallCheck } = await import("../doctor/checks/firewall.js");
        const report = await runDoctorChecks(doctorCtx, [firewallCheck]);
        for (const check of report.checks) {
          const icon = check.status === "pass" ? "✓" : check.status === "warn" ? "!" : "✗";
          console.log(`  Doctor [${icon}] ${check.name}: ${check.message}`);
        }
      } catch {
        // Doctor check not critical — skip silently
      }

      if (result.requiresRebuild) {
        console.log("");
        console.log("This integration requires container-level dependencies.");
        console.log("Run `clawhq build --stage2-only` to rebuild the agent image.");
      }
    } catch (err: unknown) {
      if (err instanceof IntegrateError) {
        console.error(`Error: ${err.message}`);
      } else {
        console.error(`Add failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      process.exitCode = 1;
    }
  });

integrateCmd
  .command("remove <category>")
  .description("Remove integration: clean credential, uninstall tool, update config")
  .action(async (category: string) => {
    const parentOpts = integrateCmd.opts() as { home: string; clawhqDir: string };
    const ctx = makeIntegrateCtx(parentOpts);

    try {
      // Flag orphaned cron dependencies before removing
      const cronDeps = await checkCronDependencies(ctx, category);
      if (cronDeps.hasActiveDependencies) {
        console.log(`Warning: active cron jobs depend on "${category}" tools:`);
        for (const job of cronDeps.dependentJobs) {
          console.log(`  - ${job.id}: ${job.task.slice(0, 80)}`);
        }
        console.log("  These jobs may fail after removal. Consider disabling them.");
      }

      const result = await removeIntegration(ctx, category);

      console.log(`Integration "${category}" removed (was: ${result.provider}).`);
      if (result.envVarsCleaned.length > 0) {
        console.log(`  Credentials cleaned: ${result.envVarsCleaned.join(", ")}`);
      }
      if (result.toolsRemoved.length > 0) {
        console.log(`  Tools removed: ${result.toolsRemoved.join(", ")}`);
      }

      // Clean identity file references
      const updatedIdentityFiles = await cleanIdentityReferences(ctx, category);
      if (updatedIdentityFiles.length > 0) {
        console.log(`  Identity files updated: ${updatedIdentityFiles.join(", ")}`);
      }

      // Tighten egress firewall allowlist
      if (result.egressDomainsRemoved.length > 0) {
        console.log(`  Egress domains removed: ${result.egressDomainsRemoved.join(", ")}`);
        const fwResult = await updateFirewallAllowlist(ctx);
        if (fwResult) {
          if (fwResult.success) {
            console.log(`  Firewall tightened: ${fwResult.message}`);
          } else {
            console.log(`  Firewall update skipped: ${fwResult.message}`);
          }
        }
      }

      console.log("");
      console.log("TOOLS.md updated.");
    } catch (err: unknown) {
      if (err instanceof IntegrateError) {
        console.error(`Error: ${err.message}`);
      } else {
        console.error(`Remove failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      process.exitCode = 1;
    }
  });

integrateCmd
  .command("swap <category> <new-provider>")
  .description("Change backend provider while preserving agent behavior (same category interface)")
  .action(async (category: string, newProvider: string) => {
    const parentOpts = integrateCmd.opts() as { home: string; clawhqDir: string };
    const ctx = makeIntegrateCtx(parentOpts);

    try {
      const provDef = findCategory(category)?.providers.find((p) => p.provider === newProvider);
      if (!provDef) {
        const catDef = findCategory(category);
        if (!catDef) {
          const available = INTEGRATION_CATEGORIES.map((c) => c.category).join(", ");
          console.error(`Unknown category "${category}". Available: ${available}`);
        } else {
          const available = catDef.providers.map((p) => p.provider).join(", ");
          console.error(`Unknown provider "${newProvider}" for "${category}". Available: ${available}`);
        }
        process.exitCode = 1;
        return;
      }

      // Credential prompt
      const { io, close } = createReadlineIO();
      let credential: string;
      try {
        credential = await io.prompt(`${provDef.promptLabel}: `, "");
      } finally {
        close();
      }

      if (!credential) {
        console.error("Credential is required.");
        process.exitCode = 1;
        return;
      }

      console.log(`Swapping ${category} provider to ${provDef.label}...`);
      const result = await swapIntegration(ctx, category, newProvider, credential, false);

      console.log(`Integration "${category}" swapped: ${result.oldProvider} → ${result.newProvider}`);
      if (result.envVarsCleaned.length > 0) {
        console.log(`  Old credentials cleaned: ${result.envVarsCleaned.join(", ")}`);
      }
      if (result.egressDomainsRemoved.length > 0 || result.egressDomainsAdded.length > 0) {
        console.log(`  Egress domains removed: ${result.egressDomainsRemoved.join(", ") || "none"}`);
        console.log(`  Egress domains added: ${result.egressDomainsAdded.join(", ") || "none"}`);

        // Update egress firewall allowlist atomically
        const fwResult = await updateFirewallAllowlist(ctx);
        if (fwResult) {
          if (fwResult.success) {
            console.log(`  Firewall updated: ${fwResult.message}`);
          } else {
            console.log(`  Firewall update skipped: ${fwResult.message}`);
          }
        }
      }
      console.log("");
      console.log("TOOLS.md updated. Agent behavior unchanged — same category interface, new backend.");
    } catch (err: unknown) {
      if (err instanceof IntegrateError) {
        console.error(`Error: ${err.message}`);
      } else {
        console.error(`Swap failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      process.exitCode = 1;
    }
  });

// Decommission phase
program
  .command("export")
  .description("Export portable agent bundle")
  .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
  .option("--output <path>", "Output directory for export bundle", ".")
  .option("--mask-pii", "Apply PII masking to all exported files")
  .option("--no-memory", "Export only identity and config (skip memory)")
  .action(async (opts: {
    home: string;
    output: string;
    maskPii?: boolean;
    memory?: boolean;
  }) => {
    const homePath = opts.home.replace(/^~/, process.env.HOME ?? "~");
    const outputDir = resolve(opts.output);

    // Commander parses --no-memory as memory: false
    const noMemory = opts.memory === false;

    const flags: string[] = [];
    if (opts.maskPii) flags.push("PII masking");
    if (noMemory) flags.push("identity + config only");
    const flagsNote = flags.length > 0 ? ` (${flags.join(", ")})` : "";
    console.log(`Creating export bundle${flagsNote}...`);

    try {
      const result = await createExport({
        openclawHome: homePath,
        outputDir,
        maskPii: opts.maskPii,
        noMemory,
      });

      console.log(`Export created: ${result.exportId}`);
      console.log(`  Files: ${result.manifest.files.length}`);
      console.log(`  Archive: ${result.archivePath}`);

      if (opts.maskPii) {
        console.log("  PII masking: applied");
      }
      if (noMemory) {
        console.log("  Memory: excluded");
      }
    } catch (err: unknown) {
      console.error(
        `Export failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exitCode = 1;
    }
  });
program
  .command("destroy")
  .description("Verified agent destruction")
  .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
  .option("--compose <path>", "Path to docker-compose.yml")
  .option("--image-tag <tag>", "Agent image tag to remove")
  .option("--base-tag <tag>", "Base image tag to remove")
  .option("--bridge <iface>", "Docker bridge interface for firewall", "docker0")
  .option("--clawhq-dir <path>", "ClawHQ config directory", "~/.clawhq")
  .option("--keep-export", "Preserve export bundle")
  .option("--dry-run", "Show what will be destroyed without destroying")
  .option("--name <name>", "Deployment name (for confirmation)")
  .action(async (opts: {
    home: string;
    compose?: string;
    imageTag?: string;
    baseTag?: string;
    bridge: string;
    clawhqDir: string;
    keepExport?: boolean;
    dryRun?: boolean;
    name?: string;
  }) => {
    const homePath = opts.home.replace(/^~/, process.env.HOME ?? "~");
    const clawhqDir = opts.clawhqDir.replace(/^~/, process.env.HOME ?? "~");

    const destroyOpts = {
      openclawHome: homePath,
      composePath: opts.compose,
      imageTag: opts.imageTag,
      baseTag: opts.baseTag,
      bridgeInterface: opts.bridge,
      clawhqConfigDir: clawhqDir,
      keepExport: opts.keepExport,
      deploymentName: opts.name,
    };

    // Dry-run mode: show what will be destroyed
    if (opts.dryRun) {
      console.log("Destruction dry-run — the following will be destroyed:");
      console.log("");

      const preview = await dryRun(destroyOpts);

      for (const item of preview.items) {
        const prefix = item.autoDestroy ? "  [auto]  " : "  [manual]";
        console.log(`${prefix} ${item.label}`);
        console.log(`           ${item.location}`);
        if (item.manualAction) {
          console.log(`           Action: ${item.manualAction}`);
        }
      }

      console.log("");
      console.log(`Backup exists: ${preview.hasBackup ? "yes" : "NO"}`);
      console.log(`Export exists: ${preview.hasExport ? "yes" : "NO"}`);

      if (!preview.hasBackup && !preview.hasExport) {
        console.log("");
        console.log("WARNING: No backup or export found.");
        console.log("Consider running `clawhq backup create` or `clawhq export` first.");
      }

      console.log("");
      console.log(`To destroy, run: clawhq destroy --name "${preview.deploymentName}"`);
      return;
    }

    // Confirmation: deployment name must be provided
    if (!opts.name) {
      // Show dry-run first so user knows what will be destroyed
      const preview = await dryRun(destroyOpts);

      if (!preview.hasBackup && !preview.hasExport) {
        console.error("No backup or export found. Create one first:");
        console.error("  clawhq backup create");
        console.error("  clawhq export");
        process.exitCode = 1;
        return;
      }

      console.error("Deployment name required for confirmation.");
      console.error(`Run: clawhq destroy --name "${preview.deploymentName}"`);
      console.error("Use --dry-run to preview what will be destroyed.");
      process.exitCode = 1;
      return;
    }

    // Execute destruction
    console.log(`Destroying deployment "${opts.name}"...`);
    console.log("");

    try {
      const result = await destroy(destroyOpts);

      const total = result.steps.length;
      for (let i = 0; i < total; i++) {
        const step = result.steps[i] as DestroyStep;
        const icon = step.status === "done" ? "OK" : step.status === "skipped" ? "SKIP" : "FAIL";
        const duration = step.durationMs >= 1000
          ? `${(step.durationMs / 1000).toFixed(1)}s`
          : `${step.durationMs}ms`;
        console.log(`[${i + 1}/${total}] ${icon}  ${step.name} (${duration}): ${step.message}`);
      }

      console.log("");
      if (result.success) {
        const totalMs = result.steps.reduce((sum, s) => sum + s.durationMs, 0);
        const duration = totalMs >= 1000
          ? `${(totalMs / 1000).toFixed(1)}s`
          : `${totalMs}ms`;
        console.log(`Destruction completed successfully (${duration})`);
        if (result.manifest) {
          console.log(`Manifest: ${result.manifest.manifestId}`);
          console.log(`Verification hash: ${result.manifest.verification.hash}`);
        }
      } else {
        const failures = result.steps.filter((s) => s.status === "failed");
        console.log(`Destruction failed (${failures.length} error${failures.length > 1 ? "s" : ""})`);
        for (const f of failures) {
          console.log(`  ${f.name}: ${f.message}`);
        }
        process.exitCode = 1;
      }
    } catch (err: unknown) {
      console.error(
        `Destruction failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exitCode = 1;
    }
  });

program.parse();

if (!process.argv.slice(2).length) {
  program.outputHelp();
}

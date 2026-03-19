#!/usr/bin/env node

/**
 * ClawHQ CLI entry point.
 *
 * Flat command structure (AD-01): `clawhq doctor`, not `clawhq operate doctor`.
 * Modules are internal source organization, never user-facing.
 *
 * Commands grouped by lifecycle phase for --help display only.
 */

import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

import chalk from "chalk";
import { Command } from "commander";
import ora from "ora";
import { stringify as yamlStringify } from "yaml";

import { install } from "../build/installer/index.js";
import type { PrereqCheckResult } from "../build/installer/index.js";
import { deploy, restart, shutdown } from "../build/launcher/index.js";
import type { DeployProgress } from "../build/launcher/index.js";
import { validateBundle } from "../config/validate.js";
import {
  loadAllBuiltinBlueprints,
  loadBlueprint,
} from "../design/blueprints/index.js";
import type { Blueprint } from "../design/blueprints/index.js";
import {
  createInquirerPrompter,
  generateBundle,
  generateIdentityFiles,
  runWizard,
  WizardAbortError,
  writeBundle,
} from "../design/configure/index.js";
import {
  approve as approveItem,
  countPending,
  listPending,
  reject as rejectItem,
  sendApprovalNotification,
  startApprovalBot,
} from "../evolve/approval/index.js";
import type { TelegramConfig } from "../evolve/approval/index.js";
import {
  destroyAgent,
  exportBundle,
  formatDestroyJson,
  formatDestroyTable,
  formatExportJson,
  formatExportTable,
  formatVerifyResult,
  verifyDestructionProof,
} from "../evolve/lifecycle/index.js";
import type { DestructionProof, LifecycleProgress } from "../evolve/lifecycle/index.js";
import {
  formatSkillList,
  formatSkillListJson,
  installSkill,
  listSkills,
  removeSkill,
} from "../evolve/skills/index.js";
import type { SkillProgress } from "../evolve/skills/index.js";
import {
  formatDoctorJson,
  formatDoctorTable,
  formatFixTable,
  runDoctor,
  runDoctorWithFix,
} from "../operate/doctor/index.js";
import {
  buildOwaspExport,
  createAuditConfig,
  formatAuditJson,
  formatAuditTable,
  readAuditReport,
} from "../secure/audit/index.js";
import { formatProbeReport, runProbes } from "../secure/credentials/health.js";

import { renderError, warnIfNotInstalled } from "./ux.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string; description: string };

const DEFAULT_DEPLOY_DIR = join(homedir(), ".clawhq");

const program = new Command();

program
  .name("clawhq")
  .description(pkg.description)
  .version(pkg.version, "-v, --version", "Print version");

program
  .command("version")
  .description("Print version info")
  .action(() => {
    console.log(`clawhq v${pkg.version}`);
  });

// ── Install Commands ────────────────────────────────────────────────────────

program
  .command("install")
  .description("Full platform install — prerequisites, engine, scaffold")
  .option("--from-source", "Zero-trust: clone, audit, build from source")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .action(async (opts: { fromSource?: boolean; deployDir: string }) => {
    try {
      console.log(chalk.bold("\nclawhq install\n"));

      // Step 1: Check prerequisites
      const spinner = ora("Checking prerequisites…");
      spinner.start();

      const result = await install({
        deployDir: opts.deployDir,
        fromSource: opts.fromSource,
      });

      spinner.stop();

      // Display prereq results
      console.log(chalk.bold("Prerequisites"));
      for (const check of result.prereqs.checks) {
        formatPrereqCheck(check);
      }
      console.log("");

      if (!result.prereqs.passed) {
        console.log(chalk.red("✘ Prerequisites not met. Fix the issues above and run again."));
        process.exit(1);
      }

      // Step 2–3: Scaffold + config (already done by install())
      console.log(chalk.green(`✔ Directory scaffolded at ${opts.deployDir}`));
      console.log(chalk.green(`✔ Config written to ${result.configPath}`));

      // Next-step guidance
      console.log(chalk.bold("\nWhat's next?\n"));
      console.log(`  1. ${chalk.bold("clawhq init --guided")}    Choose a blueprint and configure your agent`);
      console.log(`  2. ${chalk.bold("clawhq build")}             Build the Docker image`);
      console.log(`  3. ${chalk.bold("clawhq up")}                Deploy and start your agent`);
      console.log("");
      console.log(chalk.dim(`  Deployment directory: ${opts.deployDir}`));
      console.log(chalk.dim(`  Install method: ${opts.fromSource ? "from-source (zero-trust)" : "cache (default)"}`));
      console.log("");
    } catch (error) {
      console.error(renderError(error));
      process.exit(1);
    }
  });

// ── Design Commands ─────────────────────────────────────────────────────────

program
  .command("init")
  .description("Interactive setup — choose blueprint, configure, forge agent")
  .option("--guided", "Run the guided setup wizard (default)")
  .option("-b, --blueprint <name>", "Pre-select a blueprint by name")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .option("--air-gapped", "Run in air-gapped mode (no internet)")
  .action(async (opts: {
    guided?: boolean;
    blueprint?: string;
    deployDir: string;
    airGapped?: boolean;
  }) => {
    try {
      // Step 1: Run the interactive wizard
      const prompter = await createInquirerPrompter();
      const answers = await runWizard(prompter, {
        blueprintName: opts.blueprint,
        deployDir: opts.deployDir,
        airGapped: opts.airGapped,
      });

      // Step 2: Generate deployment bundle
      const spinner = ora("Generating config…");
      spinner.start();

      const bundle = generateBundle(answers);

      // Step 3: Validate against all 14 landmine rules
      const report = validateBundle(bundle);
      if (!report.valid) {
        spinner.fail("Config validation failed");
        for (const err of report.errors) {
          console.error(chalk.red(`  ✘ ${err.rule}: ${err.message}`));
        }
        process.exit(1);
      }

      // Step 4: Write files atomically
      const files = bundleToFiles(bundle, answers.blueprint);
      const result = writeBundle(answers.deployDir, files);

      spinner.succeed(`Config written to ${result.deployDir}`);

      // Show warnings if any
      for (const warn of report.warnings) {
        console.log(chalk.yellow(`  ⚠ ${warn.rule}: ${warn.message}`));
      }

      console.log(chalk.green(`\n✔ Agent forged successfully`));
      console.log(chalk.dim(`  ${result.written.length} files written`));
      console.log(chalk.dim(`  All 14 landmine rules passed`));
      console.log(chalk.dim(`\n  Next: clawhq up`));
    } catch (error) {
      if (error instanceof WizardAbortError) {
        console.log(chalk.yellow("\nSetup cancelled."));
        process.exit(0);
      }
      console.error(renderError(error));
      process.exit(1);
    }
  });

/** Convert a DeploymentBundle into FileEntry array for the atomic writer. */
function bundleToFiles(
  bundle: ReturnType<typeof generateBundle>,
  blueprint: import("../design/blueprints/types.js").Blueprint,
) {
  const identityFiles = generateIdentityFiles(blueprint);

  return [
    {
      relativePath: "engine/openclaw.json",
      content: JSON.stringify(bundle.openclawConfig, null, 2) + "\n",
    },
    {
      relativePath: "engine/docker-compose.yml",
      content: yamlStringify(bundle.composeConfig),
    },
    {
      relativePath: "engine/.env",
      content: Object.entries(bundle.envVars)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n") + "\n",
      mode: 0o600,
    },
    {
      relativePath: "engine/credentials.json",
      content: JSON.stringify({}, null, 2) + "\n",
      mode: 0o600,
    },
    {
      relativePath: "cron/jobs.json",
      content: JSON.stringify(bundle.cronJobs, null, 2) + "\n",
    },
    {
      relativePath: "clawhq.yaml",
      content: yamlStringify(bundle.clawhqConfig),
    },
    // Identity files (SOUL.md, AGENTS.md)
    ...identityFiles.map((f) => ({
      relativePath: f.relativePath,
      content: f.content,
    })),
  ];
}

const blueprint = program.command("blueprint").description("Browse and preview blueprints");

blueprint
  .command("list")
  .description("Browse available blueprints")
  .action(async () => {
    const loaded = loadAllBuiltinBlueprints();
    if (loaded.length === 0) {
      console.log(chalk.yellow("No blueprints found."));
      process.exit(1);
    }

    console.log(chalk.bold("\nAvailable Blueprints\n"));
    for (const { blueprint: bp } of loaded) {
      const slug = bp.name.toLowerCase().replace(/\s+/g, "-");
      console.log(
        `  ${chalk.bold.cyan(slug)}  ${chalk.dim("—")}  ${bp.use_case_mapping.tagline}`,
      );
      console.log(
        `    ${chalk.dim(`Replaces: ${bp.use_case_mapping.replaces}`)}`,
      );
      console.log(
        `    ${chalk.dim(`Security: ${bp.security_posture.posture} · Egress: ${bp.security_posture.egress} · Autonomy: ${bp.autonomy_model.default}`)}`,
      );
      console.log("");
    }

    console.log(chalk.dim(`  ${loaded.length} blueprints available`));
    console.log(chalk.dim("  Use: clawhq blueprint preview <name>\n"));
  });

blueprint
  .command("preview")
  .description("Preview a blueprint's operational design")
  .argument("<name>", "Blueprint name")
  .action(async (name: string) => {
    try {
      const { blueprint: bp } = loadBlueprint(name);
      printBlueprintPreview(bp);
    } catch (error) {
      console.error(renderError(error));
      process.exit(1);
    }
  });

/** Print a full blueprint preview to stdout. */
function printBlueprintPreview(bp: Blueprint): void {
  const slug = bp.name.toLowerCase().replace(/\s+/g, "-");
  const dim = chalk.dim;
  const bold = chalk.bold;

  console.log(bold(`\n${bp.name}`) + dim(` (${slug} v${bp.version})`));
  console.log(dim("═".repeat(60)));

  // Use case
  console.log(bold("\nUse Case"));
  console.log(`  Replaces:  ${bp.use_case_mapping.replaces}`);
  console.log(`  Tagline:   ${bp.use_case_mapping.tagline}`);
  console.log(`  ${bp.use_case_mapping.description.trim()}`);

  // Day in the life
  console.log(bold("\nDay in the Life"));
  console.log(`  ${bp.use_case_mapping.day_in_the_life.trim()}`);

  // Personality
  console.log(bold("\nPersonality"));
  console.log(`  Tone:          ${bp.personality.tone}`);
  console.log(`  Style:         ${bp.personality.style}`);
  console.log(`  Relationship:  ${bp.personality.relationship}`);
  console.log(`  Boundaries:    ${bp.personality.boundaries}`);

  // Security
  console.log(bold("\nSecurity"));
  console.log(`  Posture:        ${bp.security_posture.posture}`);
  console.log(`  Egress:         ${bp.security_posture.egress}`);
  console.log(`  Identity mount: ${bp.security_posture.identity_mount}`);

  // Tools
  console.log(bold("\nTools"));
  for (const tool of bp.toolbelt.tools) {
    const req = tool.required ? chalk.green("required") : dim("optional");
    console.log(`  ${chalk.cyan(tool.name)} [${tool.category}] ${req}`);
    console.log(`    ${dim(tool.description)}`);
  }

  // Skills
  console.log(bold("\nSkills"));
  for (const skill of bp.toolbelt.skills) {
    const req = skill.required ? chalk.green("required") : dim("optional");
    console.log(`  ${chalk.cyan(skill.name)} ${req}`);
    console.log(`    ${dim(skill.description)}`);
  }

  // Cron
  console.log(bold("\nCron Schedule"));
  console.log(`  Heartbeat:     ${bp.cron_config.heartbeat || dim("none")}`);
  console.log(`  Work session:  ${bp.cron_config.work_session || dim("none")}`);
  console.log(`  Morning brief: ${bp.cron_config.morning_brief || dim("none")}`);

  // Autonomy
  console.log(bold("\nAutonomy"));
  console.log(`  Default level:      ${bp.autonomy_model.default}`);
  console.log(`  Requires approval:  ${bp.autonomy_model.requires_approval.join(", ")}`);

  // Memory
  console.log(bold("\nMemory Policy"));
  console.log(`  Hot: ${bp.memory_policy.hot_max} / ${bp.memory_policy.hot_retention}`);
  console.log(`  Warm: ${bp.memory_policy.warm_retention}  Cold: ${bp.memory_policy.cold_retention}`);
  console.log(`  Summarization: ${bp.memory_policy.summarization}`);

  // Integrations
  console.log(bold("\nIntegrations"));
  console.log(`  Required:     ${bp.integration_requirements.required.join(", ")}`);
  console.log(`  Recommended:  ${bp.integration_requirements.recommended.join(", ")}`);
  if (bp.integration_requirements.optional.length > 0) {
    console.log(`  Optional:     ${bp.integration_requirements.optional.join(", ")}`);
  }

  // Channels
  console.log(bold("\nChannels"));
  console.log(`  Supported: ${bp.channels.supported.join(", ")}`);
  console.log(`  Default:   ${bp.channels.default}`);

  // Monitoring
  console.log(bold("\nMonitoring"));
  console.log(`  Heartbeat:    ${bp.monitoring.heartbeat_frequency}`);
  console.log(`  Checks:       ${bp.monitoring.checks.join(", ")}`);
  console.log(`  Quiet hours:  ${bp.monitoring.quiet_hours}`);
  console.log(`  Alert on:     ${bp.monitoring.alert_on.join(", ")}`);

  // Model routing
  console.log(bold("\nModel Routing"));
  console.log(`  Default:     ${bp.model_routing_strategy.default_provider}`);
  console.log(`  Local model: ${bp.model_routing_strategy.local_model_preference}`);
  console.log(`  Escalate:    ${bp.model_routing_strategy.cloud_escalation_categories.join(", ")}`);

  console.log("");
}

// ── Build Commands ──────────────────────────────────────────────────────────

program
  .command("build")
  .description("Two-stage Docker build with change detection and manifests")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .action(async (opts: { deployDir: string }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    console.log(chalk.yellow("Not yet implemented. Coming soon."));
    process.exit(1);
  });

// ── Deploy Commands ─────────────────────────────────────────────────────────

program
  .command("up")
  .description("Deploy agent with preflight checks, firewall, and health verify")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .option("-t, --token <token>", "Gateway auth token")
  .option("-p, --port <port>", "Gateway port", "18789")
  .option("--skip-preflight", "Skip preflight checks")
  .option("--skip-firewall", "Skip egress firewall setup")
  .action(async (opts: {
    deployDir: string;
    token?: string;
    port: string;
    skipPreflight?: boolean;
    skipFirewall?: boolean;
  }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);

    const token = opts.token ?? process.env["CLAWHQ_GATEWAY_TOKEN"] ?? "";
    if (!token) {
      console.error(chalk.red("Error: Gateway token required. Use --token or set CLAWHQ_GATEWAY_TOKEN"));
      process.exit(1);
    }

    const ac = new AbortController();
    process.on("SIGINT", () => ac.abort());
    process.on("SIGTERM", () => ac.abort());

    const spinner = ora();
    const onProgress = createProgressHandler(spinner);

    const result = await deploy({
      deployDir: opts.deployDir,
      gatewayToken: token,
      gatewayPort: parseInt(opts.port, 10),
      skipPreflight: opts.skipPreflight,
      skipFirewall: opts.skipFirewall,
      onProgress,
      signal: ac.signal,
    });

    spinner.stop();

    if (result.success) {
      console.log(chalk.green("\n✔ Agent is live and reachable"));
    } else {
      console.error(chalk.red(`\n✘ Deploy failed: ${result.error}`));
      process.exit(1);
    }
  });

program
  .command("down")
  .description("Stop agent and remove firewall rules")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .option("-v, --volumes", "Remove volumes")
  .action(async (opts: { deployDir: string; volumes?: boolean }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);

    const ac = new AbortController();
    process.on("SIGINT", () => ac.abort());
    process.on("SIGTERM", () => ac.abort());

    const spinner = ora();
    const onProgress = createProgressHandler(spinner);

    const result = await shutdown({
      deployDir: opts.deployDir,
      removeVolumes: opts.volumes,
      onProgress,
      signal: ac.signal,
    });

    spinner.stop();

    if (result.success) {
      console.log(chalk.green("\n✔ Agent stopped"));
    } else {
      console.error(chalk.red(`\n✘ Shutdown failed: ${result.error}`));
      process.exit(1);
    }
  });

program
  .command("restart")
  .description("Restart agent with firewall reapply")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .option("-t, --token <token>", "Gateway auth token")
  .option("-p, --port <port>", "Gateway port", "18789")
  .option("--skip-preflight", "Skip preflight checks")
  .option("--skip-firewall", "Skip egress firewall setup")
  .action(async (opts: {
    deployDir: string;
    token?: string;
    port: string;
    skipPreflight?: boolean;
    skipFirewall?: boolean;
  }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);

    const token = opts.token ?? process.env["CLAWHQ_GATEWAY_TOKEN"] ?? "";
    if (!token) {
      console.error(chalk.red("Error: Gateway token required. Use --token or set CLAWHQ_GATEWAY_TOKEN"));
      process.exit(1);
    }

    const ac = new AbortController();
    process.on("SIGINT", () => ac.abort());
    process.on("SIGTERM", () => ac.abort());

    const spinner = ora();
    const onProgress = createProgressHandler(spinner);

    const result = await restart({
      deployDir: opts.deployDir,
      gatewayToken: token,
      gatewayPort: parseInt(opts.port, 10),
      skipPreflight: opts.skipPreflight,
      skipFirewall: opts.skipFirewall,
      onProgress,
      signal: ac.signal,
    });

    spinner.stop();

    if (result.success) {
      console.log(chalk.green("\n✔ Agent restarted and reachable"));
    } else {
      console.error(chalk.red(`\n✘ Restart failed: ${result.error}`));
      process.exit(1);
    }
  });

program
  .command("connect")
  .description("Connect messaging channel (Telegram, Signal, Discord)")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .action(async (opts: { deployDir: string }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    console.log(chalk.yellow("Not yet implemented. Coming soon."));
    process.exit(1);
  });

// ── Secure Commands ────────────────────────────────────────────────────────

program
  .command("scan")
  .description("PII and secrets scanner")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .action(async (opts: { deployDir: string }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    console.log(chalk.yellow("Not yet implemented. Coming soon."));
    process.exit(1);
  });

program
  .command("creds")
  .description("Check credential health for all configured integrations")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .option("--configured", "Show only configured integrations (hide unconfigured)")
  .action(async (opts: { deployDir: string; configured?: boolean }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);

    const envPath = join(opts.deployDir, "engine", ".env");
    const spinner = ora("Checking credentials…");
    spinner.start();

    const report = await runProbes({
      envPath,
      includeUnconfigured: !opts.configured,
    });

    spinner.stop();
    console.log(formatProbeReport(report));

    if (!report.healthy) {
      process.exit(1);
    }
  });

program
  .command("audit")
  .description("Tool execution + egress + secret audit trail")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .option("--json", "Output as JSON for scripting")
  .option("--export", "Export in OWASP-compatible format")
  .option("--since <datetime>", "Only show events after this ISO timestamp")
  .option("-n, --limit <count>", "Max events per stream")
  .action(async (opts: {
    deployDir: string;
    json?: boolean;
    export?: boolean;
    since?: string;
    limit?: string;
  }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);

    try {
      // Use a placeholder HMAC key for reading — verification uses the key from the log
      const config = createAuditConfig(opts.deployDir, "");
      const limit = opts.limit ? parseInt(opts.limit, 10) : undefined;

      const spinner = ora("Reading audit logs…");
      if (!opts.json && !opts.export) spinner.start();

      const report = await readAuditReport(config, {
        since: opts.since,
        limit,
      });

      if (!opts.json && !opts.export) spinner.stop();

      if (opts.export) {
        const owaspExport = buildOwaspExport(report, opts.deployDir);
        console.log(JSON.stringify(owaspExport, null, 2));
      } else if (opts.json) {
        console.log(formatAuditJson(report));
      } else {
        console.log(formatAuditTable(report));
      }
    } catch (error) {
      console.error(renderError(error));
      process.exit(1);
    }
  });

// ── Operate Commands ──────────────────────────────────────────────────────

program
  .command("doctor")
  .description("Preventive diagnostics — 17 checks with auto-fix")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .option("--fix", "Auto-fix common issues")
  .option("--json", "Output as JSON for scripting")
  .action(async (opts: {
    deployDir: string;
    fix?: boolean;
    json?: boolean;
  }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);

    const ac = new AbortController();
    process.on("SIGINT", () => ac.abort());
    process.on("SIGTERM", () => ac.abort());

    const format = opts.json ? "json" : "table";

    if (opts.fix) {
      const spinner = ora("Running diagnostics and auto-fix…");
      if (!opts.json) spinner.start();

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

      if (!report.healthy) process.exit(1);
    } else {
      const spinner = ora("Running diagnostics…");
      if (!opts.json) spinner.start();

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

      if (!report.healthy) process.exit(1);
    }
  });

program
  .command("status")
  .description("Single-pane status dashboard")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .option("-w, --watch", "Continuous monitoring mode")
  .action(async (opts: { deployDir: string; watch?: boolean }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    console.log(chalk.yellow("Not yet implemented. Coming soon."));
    process.exit(1);
  });

const backup = program.command("backup").description("Encrypted backup and restore");

backup
  .command("create")
  .description("Create encrypted backup snapshot")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .action(async (opts: { deployDir: string }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    console.log(chalk.yellow("Not yet implemented. Coming soon."));
    process.exit(1);
  });

backup
  .command("list")
  .description("List available backup snapshots")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .action(async (opts: { deployDir: string }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    console.log(chalk.yellow("Not yet implemented. Coming soon."));
    process.exit(1);
  });

backup
  .command("restore")
  .description("Restore from a backup snapshot")
  .argument("<snapshot>", "Snapshot ID or path")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .action(async (_snapshot: string, opts: { deployDir: string }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    console.log(chalk.yellow("Not yet implemented. Coming soon."));
    process.exit(1);
  });

program
  .command("update")
  .description("Safe upstream upgrade with rollback")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .option("--check", "Check for updates without applying")
  .action(async (opts: { deployDir: string; check?: boolean }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    console.log(chalk.yellow("Not yet implemented. Coming soon."));
    process.exit(1);
  });

program
  .command("logs")
  .description("Stream agent logs")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .option("-f, --follow", "Follow log output")
  .option("-n, --lines <count>", "Number of lines to show", "50")
  .action(async (opts: { deployDir: string; follow?: boolean; lines: string }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    console.log(chalk.yellow("Not yet implemented. Coming soon."));
    process.exit(1);
  });

// ── Evolve Commands ─────────────────────────────────────────────────────────

const skill = program.command("skill").description("Manage agent skills");

skill
  .command("install")
  .description("Install a skill with security vetting")
  .argument("<source>", "Skill source (URL, path, or registry name)")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .option("--auto-approve", "Auto-approve if vetting passes")
  .action(async (source: string, opts: { deployDir: string; autoApprove?: boolean }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    const spinner = ora();
    const result = await installSkill({
      deployDir: opts.deployDir,
      source,
      autoApprove: opts.autoApprove,
      onProgress: createSkillProgressHandler(spinner),
    });
    if (result.success) {
      console.log(chalk.green(`\nSkill "${result.skillName}" installed and active.`));
    } else {
      console.log(chalk.red(`\nSkill installation failed: ${result.error}`));
      if (result.vetReport && result.vetReport.findings.length > 0) {
        console.log(chalk.dim("\nSecurity findings:"));
        for (const f of result.vetReport.findings) {
          const sev = f.severity === "critical" ? chalk.red(f.severity) : chalk.yellow(f.severity);
          console.log(`  ${sev} ${f.file}:${f.line} — ${f.detail}`);
        }
      }
      process.exit(1);
    }
  });

skill
  .command("update")
  .description("Update installed skills")
  .argument("[name]", "Skill name (all if omitted)")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .action(async (_name: string | undefined, opts: { deployDir: string }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    console.log(chalk.yellow("Not yet implemented. Coming soon."));
    process.exit(1);
  });

skill
  .command("remove")
  .description("Remove an installed skill")
  .argument("<name>", "Skill name")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .action(async (name: string, opts: { deployDir: string }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    const result = await removeSkill(opts.deployDir, name);
    if (result.success) {
      console.log(chalk.green(`Skill "${name}" removed.`));
    } else {
      console.log(chalk.red(`Failed to remove skill: ${result.error}`));
      process.exit(1);
    }
  });

skill
  .command("list")
  .description("List installed skills")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .option("--json", "Output as JSON")
  .action(async (opts: { deployDir: string; json?: boolean }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    const result = await listSkills({ deployDir: opts.deployDir });
    if (opts.json) {
      console.log(formatSkillListJson(result));
    } else {
      console.log(formatSkillList(result));
    }
  });

program
  .command("evolve")
  .description("Manage agent capabilities")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .action(async (opts: { deployDir: string }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    console.log(chalk.yellow("Not yet implemented. Coming soon."));
    process.exit(1);
  });

// ── Approval Commands ──────────────────────────────────────────────────────

const approval = program.command("approval").description("Manage approval queue for high-stakes actions");

approval
  .command("list")
  .description("List pending approval items")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .option("--json", "Output as JSON")
  .action(async (opts: { deployDir: string; json?: boolean }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    const pending = await listPending(opts.deployDir);
    if (opts.json) {
      console.log(JSON.stringify(pending, null, 2));
      return;
    }
    if (pending.length === 0) {
      console.log(chalk.dim("No pending approvals."));
      return;
    }
    console.log(chalk.bold(`${pending.length} pending approval(s):\n`));
    for (const item of pending) {
      console.log(`  ${chalk.cyan(item.id)}  ${item.category}  ${item.summary}`);
      if (item.metadata) {
        const meta = Object.entries(item.metadata).map(([k, v]) => `${k}=${v}`).join(", ");
        console.log(`    ${chalk.dim(meta)}`);
      }
      console.log(`    ${chalk.dim(`source: ${item.source}  queued: ${item.createdAt}`)}`);
      console.log();
    }
  });

approval
  .command("approve")
  .description("Approve a pending item")
  .argument("<id>", "Approval item ID")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .action(async (id: string, opts: { deployDir: string }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    const auditConfig = createAuditConfig(opts.deployDir, "");
    const result = await approveItem(opts.deployDir, id, { resolvedVia: "cli", auditConfig });
    if (result.success) {
      console.log(chalk.green(`Approved: ${id}`));
    } else {
      console.log(chalk.red(result.error ?? "Failed to approve."));
      process.exit(1);
    }
  });

approval
  .command("reject")
  .description("Reject a pending item")
  .argument("<id>", "Approval item ID")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .action(async (id: string, opts: { deployDir: string }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    const auditConfig = createAuditConfig(opts.deployDir, "");
    const result = await rejectItem(opts.deployDir, id, { resolvedVia: "cli", auditConfig });
    if (result.success) {
      console.log(chalk.green(`Rejected: ${id}`));
    } else {
      console.log(chalk.red(result.error ?? "Failed to reject."));
      process.exit(1);
    }
  });

approval
  .command("count")
  .description("Count pending approval items")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .action(async (opts: { deployDir: string }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    const count = await countPending(opts.deployDir);
    console.log(String(count));
  });

approval
  .command("watch")
  .description("Start Telegram approval bot (polls for approve/reject button presses)")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .action(async (opts: { deployDir: string }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);

    const { readEnvValue } = await import("../secure/credentials/env-store.js");
    const envPath = join(opts.deployDir, "engine", ".env");
    const botToken = readEnvValue(envPath, "TELEGRAM_BOT_TOKEN");
    const chatId = readEnvValue(envPath, "TELEGRAM_CHAT_ID");

    if (!botToken) {
      console.error(chalk.red("TELEGRAM_BOT_TOKEN not set in .env. Configure via clawhq creds."));
      process.exit(1);
    }
    if (!chatId) {
      console.error(chalk.red("TELEGRAM_CHAT_ID not set in .env. Set the chat ID for approval notifications."));
      process.exit(1);
    }

    const telegramConfig: TelegramConfig = { botToken, chatId };
    const auditConfig = createAuditConfig(opts.deployDir, "");
    const ac = new AbortController();

    process.on("SIGINT", () => ac.abort());
    process.on("SIGTERM", () => ac.abort());

    console.log(chalk.green("Approval bot started. Listening for Telegram callbacks..."));
    console.log(chalk.dim("Press Ctrl+C to stop.\n"));

    await startApprovalBot({
      deployDir: opts.deployDir,
      telegramConfig,
      auditConfig,
      signal: ac.signal,
      onResolution: (itemId, resolution) => {
        const color = resolution === "approved" ? chalk.green : chalk.red;
        console.log(`${color(resolution)}: ${itemId}`);
      },
    });

    console.log(chalk.dim("\nApproval bot stopped."));
  });

approval
  .command("notify")
  .description("Send Telegram notification for a pending approval item")
  .argument("<id>", "Approval item ID")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .action(async (id: string, opts: { deployDir: string }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);

    const { readEnvValue } = await import("../secure/credentials/env-store.js");
    const { getItem } = await import("../evolve/approval/queue.js");
    const envPath = join(opts.deployDir, "engine", ".env");
    const botToken = readEnvValue(envPath, "TELEGRAM_BOT_TOKEN");
    const chatId = readEnvValue(envPath, "TELEGRAM_CHAT_ID");

    if (!botToken || !chatId) {
      console.error(chalk.red("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in .env."));
      process.exit(1);
    }

    const item = await getItem(opts.deployDir, id);
    if (!item) {
      console.error(chalk.red(`Approval item "${id}" not found.`));
      process.exit(1);
    }
    if (item.status !== "pending") {
      console.error(chalk.red(`Item "${id}" is already ${item.status}.`));
      process.exit(1);
    }

    const result = await sendApprovalNotification({ botToken, chatId }, item);
    if (result.success) {
      console.log(chalk.green(`Telegram notification sent for ${id}.`));
    } else {
      console.error(chalk.red(`Failed to notify: ${result.error}`));
      process.exit(1);
    }
  });

program
  .command("export")
  .description("Export portable agent bundle")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .option("-o, --output <path>", "Output file path")
  .option("--json", "Output as JSON for scripting")
  .action(async (opts: { deployDir: string; output?: string; json?: boolean }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    const spinner = ora();
    const onProgress = (event: LifecycleProgress): void => {
      const label = `[${event.step}]`;
      switch (event.status) {
        case "running": spinner.start(`${label} ${event.message}`); break;
        case "done": spinner.succeed(`${label} ${event.message}`); break;
        case "failed": spinner.fail(`${label} ${event.message}`); break;
        case "skipped": spinner.warn(`${label} ${event.message}`); break;
      }
    };
    try {
      const result = await exportBundle({ deployDir: opts.deployDir, output: opts.output, onProgress });
      console.log();
      console.log(opts.json ? formatExportJson(result) : formatExportTable(result));
      process.exit(result.success ? 0 : 1);
    } catch (err) {
      spinner.stop();
      console.error(renderError(err));
      process.exit(1);
    }
  });

program
  .command("destroy")
  .description("Verified agent destruction")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .option("--confirm", "Skip confirmation prompt")
  .option("--json", "Output as JSON for scripting")
  .action(async (opts: { deployDir: string; confirm?: boolean; json?: boolean }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    if (!opts.confirm) {
      console.log(chalk.red.bold("⚠  WARNING: This will permanently destroy ALL agent data."));
      console.log(chalk.red("   This action cannot be undone.\n"));
      console.log(`   Deploy dir: ${opts.deployDir}\n`);
      console.log(chalk.yellow("   Run with --confirm to proceed."));
      process.exit(1);
    }
    const spinner = ora();
    const onProgress = (event: LifecycleProgress): void => {
      const label = `[${event.step}]`;
      switch (event.status) {
        case "running": spinner.start(`${label} ${event.message}`); break;
        case "done": spinner.succeed(`${label} ${event.message}`); break;
        case "failed": spinner.fail(`${label} ${event.message}`); break;
        case "skipped": spinner.warn(`${label} ${event.message}`); break;
      }
    };
    try {
      const result = await destroyAgent({ deployDir: opts.deployDir, confirm: true, onProgress });
      console.log();
      console.log(opts.json ? formatDestroyJson(result) : formatDestroyTable(result));
      process.exit(result.success ? 0 : 1);
    } catch (err) {
      spinner.stop();
      console.error(renderError(err));
      process.exit(1);
    }
  });

program
  .command("verify-proof")
  .description("Verify a destruction proof file")
  .argument("<file>", "Path to the destruction proof JSON file")
  .action(async (file: string) => {
    try {
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(file, "utf-8");
      const proof = JSON.parse(raw) as DestructionProof;
      const valid = verifyDestructionProof(proof);
      console.log(formatVerifyResult(proof, valid));
      process.exit(valid ? 0 : 1);
    } catch (err) {
      console.error(renderError(err));
      process.exit(1);
    }
  });

// ── Cloud Commands ──────────────────────────────────────────────────────────

const cloud = program.command("cloud").description("Remote monitoring and managed hosting (optional)");

cloud
  .command("connect")
  .description("Link to clawhq.com for remote monitoring")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .action(async (opts: { deployDir: string }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    console.log(chalk.yellow("Not yet implemented. Coming soon."));
    process.exit(1);
  });

cloud
  .command("status")
  .description("Remote health dashboard")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .action(async (opts: { deployDir: string }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    console.log(chalk.yellow("Not yet implemented. Coming soon."));
    process.exit(1);
  });

cloud
  .command("disconnect")
  .description("Disconnect from cloud — agent keeps running")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .action(async (opts: { deployDir: string }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    console.log(chalk.yellow("Not yet implemented. Coming soon."));
    process.exit(1);
  });

// ── Prereq Formatting ──────────────────────────────────────────────────────

function formatPrereqCheck(check: PrereqCheckResult): void {
  if (check.ok) {
    console.log(chalk.green(`  ✔ ${check.name}`), chalk.dim(check.detail));
  } else {
    console.log(chalk.red(`  ✘ ${check.name}`), check.detail);
  }
}

// ── Progress Handler ────────────────────────────────────────────────────────

function createProgressHandler(spinner: ReturnType<typeof ora>) {
  return (event: DeployProgress): void => {
    const label = stepLabel(event.step);
    switch (event.status) {
      case "running":
        spinner.start(`${label} ${event.message}`);
        break;
      case "done":
        spinner.succeed(`${label} ${event.message}`);
        break;
      case "failed":
        spinner.fail(`${label} ${event.message}`);
        break;
      case "skipped":
        spinner.warn(`${label} ${event.message}`);
        break;
    }
  };
}

function stepLabel(step: string): string {
  const labels: Record<string, string> = {
    "preflight": "[preflight]",
    "compose-up": "[compose]",
    "firewall": "[firewall]",
    "health-verify": "[health]",
    "smoke-test": "[smoke]",
  };
  return chalk.dim(labels[step] ?? `[${step}]`);
}

// ── Skill Progress Handler ────────────────────────────────────────────────

function createSkillProgressHandler(spinner: ReturnType<typeof ora>) {
  return (event: SkillProgress): void => {
    const label = chalk.dim(`[${event.step}]`);
    switch (event.status) {
      case "running":
        spinner.start(`${label} ${event.message}`);
        break;
      case "done":
        spinner.succeed(`${label} ${event.message}`);
        break;
      case "failed":
        spinner.fail(`${label} ${event.message}`);
        break;
      case "skipped":
        spinner.warn(`${label} ${event.message}`);
        break;
    }
  };
}

// ── Parse ───────────────────────────────────────────────────────────────────

if (!process.argv.slice(2).length) {
  program.outputHelp();
} else {
  program.parseAsync(process.argv).catch((err: unknown) => {
    console.error(renderError(err));
    process.exit(1);
  });
}

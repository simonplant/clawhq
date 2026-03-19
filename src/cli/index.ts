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

import { deploy, restart, shutdown } from "../build/launcher/index.js";
import type { DeployProgress } from "../build/launcher/index.js";
import { validateBundle } from "../config/validate.js";
import {
  createInquirerPrompter,
  generateBundle,
  generateIdentityFiles,
  runWizard,
  WizardAbortError,
  writeBundle,
} from "../design/configure/index.js";
import {
  formatDoctorJson,
  formatDoctorTable,
  formatFixTable,
  runDoctor,
  runDoctorWithFix,
} from "../operate/doctor/index.js";
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
  .action(async () => {
    console.log(chalk.yellow("Not yet implemented. Coming soon."));
    process.exit(1);
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
    console.log(chalk.yellow("Not yet implemented. Coming soon."));
    process.exit(1);
  });

blueprint
  .command("preview")
  .description("Preview a blueprint's operational design")
  .argument("<name>", "Blueprint name")
  .action(async () => {
    console.log(chalk.yellow("Not yet implemented. Coming soon."));
    process.exit(1);
  });

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
  .description("Tool execution and egress audit trail")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .action(async (opts: { deployDir: string }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    console.log(chalk.yellow("Not yet implemented. Coming soon."));
    process.exit(1);
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
  .action(async (_source: string, opts: { deployDir: string }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    console.log(chalk.yellow("Not yet implemented. Coming soon."));
    process.exit(1);
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
  .action(async (_name: string, opts: { deployDir: string }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    console.log(chalk.yellow("Not yet implemented. Coming soon."));
    process.exit(1);
  });

skill
  .command("list")
  .description("List installed skills")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .action(async (opts: { deployDir: string }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    console.log(chalk.yellow("Not yet implemented. Coming soon."));
    process.exit(1);
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

program
  .command("export")
  .description("Export portable agent bundle")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .option("-o, --output <path>", "Output file path")
  .action(async (opts: { deployDir: string; output?: string }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    console.log(chalk.yellow("Not yet implemented. Coming soon."));
    process.exit(1);
  });

program
  .command("destroy")
  .description("Verified agent destruction")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .option("--confirm", "Skip confirmation prompt")
  .action(async (opts: { deployDir: string; confirm?: boolean }) => {
    if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
    console.log(chalk.yellow("Not yet implemented. Coming soon."));
    process.exit(1);
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

// ── Parse ───────────────────────────────────────────────────────────────────

if (!process.argv.slice(2).length) {
  program.outputHelp();
} else {
  program.parseAsync(process.argv).catch((err: unknown) => {
    console.error(renderError(err));
    process.exit(1);
  });
}

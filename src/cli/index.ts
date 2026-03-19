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

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string; description: string };

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

// ── Design Commands ─────────────────────────────────────────────────────────

program
  .command("init")
  .description("Interactive setup — choose blueprint, configure, forge agent")
  .option("--guided", "Run the guided setup wizard (default)")
  .option("-b, --blueprint <name>", "Pre-select a blueprint by name")
  .option("-d, --deploy-dir <path>", "Deployment directory", join(homedir(), ".clawhq"))
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
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`\nSetup failed: ${message}`));
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

// ── Deploy Commands ─────────────────────────────────────────────────────────

const DEFAULT_DEPLOY_DIR = join(homedir(), ".clawhq");

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

// ── Secure Commands ────────────────────────────────────────────────────────

program
  .command("creds")
  .description("Check credential health for all configured integrations")
  .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .option("--configured", "Show only configured integrations (hide unconfigured)")
  .action(async (opts: { deployDir: string; configured?: boolean }) => {
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

// ── Commands are registered here as they're built ──
// Each command file exports a create*Command() function.
// Group labels use program.commandsGroup() for --help display.

if (!process.argv.slice(2).length) {
  program.outputHelp();
} else {
  program.parseAsync(process.argv).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  });
}

import { join } from "node:path";

import type { Command } from "commander";

import chalk from "chalk";
import ora from "ora";

import {
  buildOwaspExport,
  createAuditConfig,
  formatAuditJson,
  formatAuditTable,
  readAuditReport,
} from "../../secure/audit/index.js";
import { formatProbeReport, runProbes } from "../../secure/credentials/health.js";

import { CommandError } from "../errors.js";
import { renderError, ensureInstalled } from "../ux.js";

export function registerSecureCommands(program: Command, defaultDeployDir: string): void {
  program
    .command("scan")
    .description("Scan for secrets and PII using gitleaks")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .action(async (opts: { deployDir: string }) => {
      ensureInstalled(opts.deployDir);
      const { execSync } = await import("node:child_process");

      try {
        execSync("gitleaks version", { stdio: "ignore" });
      } catch {
        console.log(chalk.yellow("gitleaks is not installed.\n"));
        console.log("Install gitleaks for secret scanning (800+ patterns, actively maintained):\n");
        console.log("  brew install gitleaks          # macOS");
        console.log("  sudo apt install gitleaks      # Debian/Ubuntu");
        console.log("  https://github.com/gitleaks/gitleaks#installing\n");
        throw new CommandError("", 1);
      }

      try {
        execSync(`gitleaks detect --source "${opts.deployDir}" --verbose`, { stdio: "inherit" });
        console.log(chalk.green("\n✔ No secrets detected."));
      } catch {
        throw new CommandError("", 1);
      }
    });

  program
    .command("creds")
    .description("Check credential health for all configured integrations")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--configured", "Show only configured integrations (hide unconfigured)")
    .action(async (opts: { deployDir: string; configured?: boolean }) => {
      ensureInstalled(opts.deployDir);

      const envPath = join(opts.deployDir, "engine", ".env");
      const spinner = ora("Checking credentials…");
      spinner.start();

      try {
        const report = await runProbes({
          envPath,
          includeUnconfigured: !opts.configured,
        });

        spinner.stop();
        console.log(formatProbeReport(report));

        if (!report.healthy) {
          throw new CommandError("", 1);
        }
      } finally {
        spinner.stop();
      }
    });

  program
    .command("audit")
    .description("Tool execution + egress + secret audit trail")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
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
      ensureInstalled(opts.deployDir);

      const config = createAuditConfig(opts.deployDir, "");
      const limit = opts.limit ? parseInt(opts.limit, 10) : undefined;

      const spinner = ora("Reading audit logs…");
      if (!opts.json && !opts.export) spinner.start();

      try {
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
        spinner.stop();
        if (error instanceof CommandError) throw error;
        console.error(renderError(error));
        throw new CommandError("", 1);
      }
    });
}

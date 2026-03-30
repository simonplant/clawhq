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
    .description("PII and secrets scanner")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--git", "Scan git history for committed secrets")
    .option("--max-commits <n>", "Max git commits to scan (default: 100)", "100")
    .option("--json", "Output as JSON")
    .action(async (opts: { deployDir: string; git?: boolean; maxCommits: string; json?: boolean }) => {
      ensureInstalled(opts.deployDir);
      const { runScan, formatScanTable, formatScanJson } = await import("../../secure/scanner/index.js");
      const spinner = ora("Scanning for secrets and PII…");
      if (!opts.json) spinner.start();

      try {
        const report = await runScan({
          deployDir: opts.deployDir,
          git: opts.git,
          maxCommits: parseInt(opts.maxCommits, 10),
        });

        if (!opts.json) spinner.stop();

        if (opts.json) {
          console.log(formatScanJson(report));
        } else {
          console.log(formatScanTable(report));
        }

        if (!report.clean) throw new CommandError("", 1);
      } catch (error) {
        if (error instanceof CommandError) throw error;
        spinner.stop();
        console.error(renderError(error));
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

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

import { renderError, warnIfNotInstalled } from "../ux.js";

export function registerSecureCommands(program: Command, defaultDeployDir: string): void {
  program
    .command("scan")
    .description("PII and secrets scanner")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--git", "Scan git history for committed secrets")
    .option("--max-commits <n>", "Max git commits to scan (default: 100)", "100")
    .option("--json", "Output as JSON")
    .action(async (opts: { deployDir: string; git?: boolean; maxCommits: string; json?: boolean }) => {
      if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
      try {
        const { runScan, formatScanTable, formatScanJson } = await import("../../secure/scanner/index.js");
        const spinner = ora("Scanning for secrets and PII…");
        if (!opts.json) spinner.start();

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

        if (!report.clean) process.exit(1);
      } catch (error) {
        console.error(renderError(error));
        process.exit(1);
      }
    });

  program
    .command("creds")
    .description("Check credential health for all configured integrations")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
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
}

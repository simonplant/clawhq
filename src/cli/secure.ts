/**
 * `clawhq scan`, `clawhq creds`, and `clawhq audit` commands — Secure phase.
 */

import { resolve } from "node:path";

import { Command } from "commander";

import {
  collectEgressAudit,
  formatEgressAuditJson,
  formatEgressAuditTable,
  generateExportReport,
  generateZeroEgressAttestation,
} from "../audit/index.js";
import { formatCredTable, runProbesFromFile } from "../security/credentials/index.js";
import { formatScanTable, scanFiles, scanGitHistory } from "../security/secrets/scanner.js";

/**
 * Register Secure-phase commands (scan, creds, audit) on the program.
 */
export function createSecureCommands(program: Command): void {
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

  program
    .command("audit")
    .description("View audit logs")
    .option("--egress", "Show egress audit (outbound API calls and blocked packets)")
    .option("--since <date>", "Only include entries since this date (ISO 8601)")
    .option("--export", "Generate a signed export report")
    .option("--zero", "Verify zero egress and generate attestation")
    .option("--json", "Output as JSON")
    .option("--egress-log <path>", "Path to egress log file")
    .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
    .option("--no-drops", "Exclude firewall drop log from report")
    .action(async (opts: {
      egress?: boolean;
      since?: string;
      export?: boolean;
      zero?: boolean;
      json?: boolean;
      egressLog?: string;
      home?: string;
      drops?: boolean;
    }) => {
      if (!opts.egress) {
        console.log("Usage: clawhq audit --egress [options]");
        console.log("Run clawhq audit --help for details.");
        return;
      }

      try {
        const report = await collectEgressAudit({
          openclawHome: opts.home,
          egressLogPath: opts.egressLog,
          since: opts.since ?? null,
          includeDrops: opts.drops !== false,
        });

        if (opts.zero) {
          const attestation = generateZeroEgressAttestation(report);
          if (attestation) {
            console.log(attestation);
          } else {
            console.log(
              `Zero-egress verification FAILED: ${report.summary.totalCalls} API call(s) recorded.`,
            );
            console.log("Run clawhq audit --egress for details.");
            process.exitCode = 1;
          }
          return;
        }

        if (opts.export) {
          console.log(generateExportReport(report));
          return;
        }

        if (opts.json) {
          console.log(formatEgressAuditJson(report));
        } else {
          console.log(formatEgressAuditTable(report));
        }
      } catch (err: unknown) {
        console.error(
          `Audit failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    });
}

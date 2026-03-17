/**
 * `clawhq scan`, `clawhq creds`, and `clawhq audit` commands — Secure phase.
 */

import { resolve } from "node:path";

import chalk from "chalk";
import { Command } from "commander";

import {
  collectEgressAudit,
  collectToolAudit,
  formatEgressAuditJson,
  formatEgressAuditTable,
  formatToolAuditJson,
  formatToolAuditTable,
  generateComplianceReport,
  generateExportReport,
  generateToolExportReport,
  generateZeroEgressAttestation,
} from "../audit/index.js";
import { formatCredTable, runProbesFromFile } from "../security/credentials/index.js";
import { formatScanTable, scanFiles, scanGitHistory } from "../security/secrets/scanner.js";

import { spinner, status } from "./ui.js";

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

      const scanSpinner = spinner(`${chalk.yellow("Secure")} Scanning for secrets and PII...`);
      scanSpinner.start();

      try {
        const result = await scanFiles(resolvedPath);
        let historyMatches: Awaited<ReturnType<typeof scanGitHistory>> = [];

        if (opts.history) {
          scanSpinner.text = `${chalk.yellow("Secure")} Scanning git history...`;
          historyMatches = await scanGitHistory(resolvedPath);
        }

        const totalIssues = result.matches.length + historyMatches.length;
        if (totalIssues === 0) {
          scanSpinner.succeed(`${chalk.yellow("Secure")} ${status.pass} No secrets or PII found`);
        } else {
          scanSpinner.fail(`${chalk.yellow("Secure")} ${status.fail} ${totalIssues} issue${totalIssues > 1 ? "s" : ""} found`);
        }

        if (opts.json) {
          console.log(JSON.stringify({
            ...result,
            historyMatches,
            totalIssues,
          }, null, 2));
        } else {
          console.log(formatScanTable(result, historyMatches));
        }

        if (totalIssues > 0) {
          process.exitCode = 1;
        }
      } catch (err: unknown) {
        scanSpinner.fail(`${chalk.yellow("Secure")} ${status.fail} Scan failed`);
        console.error(
          err instanceof Error ? err.message : String(err),
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

      const credsSpinner = spinner(`${chalk.yellow("Secure")} Checking credentials...`);
      credsSpinner.start();

      try {
        const report = await runProbesFromFile(envPath);

        const hasFailures = report.counts.failing > 0 || report.counts.expired > 0;
        if (hasFailures) {
          credsSpinner.fail(`${chalk.yellow("Secure")} ${status.fail} Credential issues detected`);
        } else {
          credsSpinner.succeed(`${chalk.yellow("Secure")} ${status.pass} All credentials healthy`);
        }

        if (opts.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(formatCredTable(report));
        }

        if (hasFailures) {
          process.exitCode = 1;
        }
      } catch (err: unknown) {
        credsSpinner.fail(`${chalk.yellow("Secure")} ${status.fail} Credential check failed`);
        console.error(
          `Cannot read .env file at ${envPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    });

  program
    .command("audit")
    .description("View audit logs (tool execution trail or egress)")
    .option("--egress", "Show egress audit (outbound API calls and blocked packets)")
    .option("--compliance", "Generate OWASP GenAI Top 10 compliance report")
    .option("--since <date>", "Only include entries since this date (ISO 8601)")
    .option("--export", "Generate a signed export report")
    .option("--zero", "Verify zero egress and generate attestation (egress mode only)")
    .option("--tool <name>", "Filter by tool name (tool audit mode)")
    .option("--limit <count>", "Maximum entries to display")
    .option("--json", "Output as JSON")
    .option("--egress-log <path>", "Path to egress log file")
    .option("--tool-log <path>", "Path to tool audit log file")
    .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
    .option("--no-drops", "Exclude firewall drop log from egress report")
    .action(async (opts: {
      egress?: boolean;
      compliance?: boolean;
      since?: string;
      export?: boolean;
      zero?: boolean;
      tool?: string;
      limit?: string;
      json?: boolean;
      egressLog?: string;
      toolLog?: string;
      home?: string;
      drops?: boolean;
    }) => {
      // Egress audit mode
      if (opts.egress) {
        await handleEgressAudit(opts);
        return;
      }

      // Default: tool execution audit trail
      await handleToolAudit(opts);
    });
}

// ── Egress audit handler ───────────────────────────────────────────

async function handleEgressAudit(opts: {
  since?: string;
  export?: boolean;
  zero?: boolean;
  json?: boolean;
  egressLog?: string;
  home?: string;
  drops?: boolean;
}): Promise<void> {
  const auditSpinner = spinner(`${chalk.yellow("Secure")} Collecting egress audit...`);
  auditSpinner.start();

  try {
    const report = await collectEgressAudit({
      openclawHome: opts.home,
      egressLogPath: opts.egressLog,
      since: opts.since ?? null,
      includeDrops: opts.drops !== false,
    });
    auditSpinner.succeed(`${chalk.yellow("Secure")} ${status.pass} Egress audit collected`);

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
    auditSpinner.fail(`${chalk.yellow("Secure")} ${status.fail} Egress audit failed`);
    console.error(
      err instanceof Error ? err.message : String(err),
    );
    process.exitCode = 1;
  }
}

// ── Tool audit handler ─────────────────────────────────────────────

async function handleToolAudit(opts: {
  compliance?: boolean;
  since?: string;
  export?: boolean;
  tool?: string;
  limit?: string;
  json?: boolean;
  toolLog?: string;
  home?: string;
}): Promise<void> {
  const auditSpinner = spinner(`${chalk.yellow("Secure")} Collecting tool execution audit...`);
  auditSpinner.start();

  try {
    const report = await collectToolAudit({
      openclawHome: opts.home,
      logPath: opts.toolLog,
      since: opts.since ?? null,
      tool: opts.tool,
      limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
    });
    auditSpinner.succeed(`${chalk.yellow("Secure")} ${status.pass} Tool audit collected`);

    if (opts.compliance) {
      console.log(generateComplianceReport(report));
      return;
    }

    if (opts.export) {
      console.log(generateToolExportReport(report));
      return;
    }

    if (opts.json) {
      console.log(formatToolAuditJson(report));
    } else {
      console.log(formatToolAuditTable(report));
    }
  } catch (err: unknown) {
    auditSpinner.fail(`${chalk.yellow("Secure")} ${status.fail} Tool audit failed`);
    console.error(
      err instanceof Error ? err.message : String(err),
    );
    process.exitCode = 1;
  }
}

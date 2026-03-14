/**
 * Doctor diagnostic runner.
 *
 * Executes all checks sequentially and aggregates results into a DoctorReport.
 * Supports table-formatted output and JSON output.
 */


// --- Default check registry ---

import { configValidationCheck } from "./checks/config-validation.js";
import { containerHealthCheck } from "./checks/container-health.js";
import { dockerDaemonCheck } from "./checks/docker-daemon.js";
import { filePermissionsCheck } from "./checks/file-permissions.js";
import { firewallCheck } from "./checks/firewall.js";
import { memoryHealthCheck } from "./checks/memory-health.js";
import { openclawImagesCheck } from "./checks/openclaw-images.js";
import { openclawSourceCheck } from "./checks/openclaw-source.js";
import { portAvailabilityCheck } from "./checks/port-availability.js";
import { secretsScanCheck } from "./checks/secrets-scan.js";
import { securityPostureCheck } from "./checks/security-posture.js";
import type { Check, CheckResult, CheckStatus, DoctorContext, DoctorReport } from "./types.js";

export const DEFAULT_CHECKS: Check[] = [
  dockerDaemonCheck,
  openclawSourceCheck,
  openclawImagesCheck,
  configValidationCheck,
  filePermissionsCheck,
  secretsScanCheck,
  containerHealthCheck,
  portAvailabilityCheck,
  securityPostureCheck,
  firewallCheck,
  memoryHealthCheck,
];

// --- Runner ---

export async function runChecks(
  ctx: DoctorContext,
  checks: Check[] = DEFAULT_CHECKS,
): Promise<DoctorReport> {
  const results: CheckResult[] = [];

  for (const check of checks) {
    try {
      const result = await check.run(ctx);
      results.push(result);
    } catch (err: unknown) {
      results.push({
        name: check.name,
        status: "fail",
        message: `Check threw: ${err instanceof Error ? err.message : String(err)}`,
        fix: "",
      });
    }
  }

  const counts = { pass: 0, warn: 0, fail: 0 };
  for (const r of results) {
    counts[r.status]++;
  }

  return {
    checks: results,
    passed: counts.fail === 0,
    counts,
  };
}

// --- Output formatting ---

const STATUS_ICONS: Record<CheckStatus, string> = {
  pass: "PASS",
  warn: "WARN",
  fail: "FAIL",
};

export function formatTable(report: DoctorReport): string {
  const lines: string[] = [];

  // Calculate column widths
  const nameWidth = Math.max(5, ...report.checks.map((c) => c.name.length));
  const statusWidth = 6; // "STATUS" header or "PASS"/"WARN"/"FAIL"

  // Header
  lines.push(
    `${"CHECK".padEnd(nameWidth)}  ${"STATUS".padEnd(statusWidth)}  MESSAGE`,
  );
  lines.push("-".repeat(nameWidth + statusWidth + nameWidth + 10));

  // Rows
  for (const check of report.checks) {
    const icon = STATUS_ICONS[check.status];
    lines.push(
      `${check.name.padEnd(nameWidth)}  ${icon.padEnd(statusWidth)}  ${check.message}`,
    );
  }

  // Summary
  lines.push("");
  lines.push(
    `${report.counts.pass} passed, ${report.counts.warn} warnings, ${report.counts.fail} failed`,
  );

  return lines.join("\n");
}

export function formatJson(report: DoctorReport): string {
  return JSON.stringify(report, null, 2);
}

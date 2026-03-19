/**
 * Output formatters for doctor diagnostics.
 *
 * Two modes:
 *   - Table: aligned columns with pass/fail status for terminal display
 *   - JSON: structured output for scripting and automation
 */

import type { DoctorCheckResult, DoctorReport, FixReport } from "./types.js";

// ── Table Formatter ─────────────────────────────────────────────────────────

/**
 * Format a DoctorReport as a clean status table for terminal output.
 *
 * Example output:
 * ```
 *   Check               Status   Message
 *   ─────────────────   ──────   ──────────────────────────────────
 *   config-exists       ✔ pass   Config file exists
 *   config-valid        ✘ FAIL   Config has 2 landmine violation(s)
 *                                → Run: clawhq init --guided
 *   secrets-perms       ✔ pass   Secrets file has correct permissions
 *   firewall-active     - skip   Cannot check firewall (requires sudo)
 * ```
 */
export function formatDoctorTable(report: DoctorReport): string {
  if (report.checks.length === 0) {
    return "No checks were run.";
  }

  // Column widths
  const col1 = Math.max(5, ...report.checks.map((c) => c.name.length)) + 2;
  const col2 = 9; // "✔ pass " / "✘ FAIL " / "⚠ warn " / "- skip "

  const header = pad("Check", col1) + pad("Status", col2) + "Message";
  const separator =
    pad("─".repeat(col1 - 2), col1) +
    pad("─".repeat(col2 - 2), col2) +
    "─".repeat(40);

  const rows = report.checks.map((c) => {
    const status = statusSymbol(c);
    let line = pad(c.name, col1) + pad(status, col2) + c.message;

    if (!c.passed && c.fix) {
      line += "\n" + " ".repeat(col1 + col2) + `→ ${c.fix}`;
    }
    return line;
  });

  const lines = [header, separator, ...rows];

  // Summary line
  const { errors, warnings, passed } = report;
  if (report.healthy) {
    lines.push(`\n✔ All ${report.checks.length} checks passed`);
  } else {
    const parts: string[] = [];
    parts.push(`${passed.length} passed`);
    if (errors.length > 0) parts.push(`${errors.length} error(s)`);
    if (warnings.length > 0) parts.push(`${warnings.length} warning(s)`);
    lines.push(`\n${parts.join(", ")} out of ${report.checks.length} checks`);
  }

  return lines.join("\n");
}

/**
 * Format a FixReport as a summary table.
 */
export function formatFixTable(fixReport: FixReport): string {
  if (fixReport.fixes.length === 0) {
    return "No fixable issues found.";
  }

  const lines: string[] = ["\n── Auto-fix Results ──"];

  for (const fix of fixReport.fixes) {
    const symbol = fix.success ? "✔" : "✘";
    lines.push(`  ${symbol} ${fix.name}: ${fix.message}`);
  }

  const { fixed, failed } = fixReport;
  if (failed === 0) {
    lines.push(`\n✔ Fixed ${fixed} issue(s)`);
  } else {
    lines.push(`\n${fixed} fixed, ${failed} failed`);
  }

  return lines.join("\n");
}

// ── JSON Formatter ──────────────────────────────────────────────────────────

/**
 * Format a DoctorReport as JSON for scripting and automation.
 */
export function formatDoctorJson(report: DoctorReport, fixReport?: FixReport): string {
  const output: Record<string, unknown> = {
    timestamp: report.timestamp,
    healthy: report.healthy,
    summary: {
      total: report.checks.length,
      passed: report.passed.length,
      errors: report.errors.length,
      warnings: report.warnings.length,
    },
    checks: report.checks.map((c) => ({
      name: c.name,
      passed: c.passed,
      severity: c.severity,
      message: c.message,
      fix: c.fix ?? null,
      fixable: c.fixable ?? false,
    })),
  };

  if (fixReport) {
    output["fixes"] = {
      fixed: fixReport.fixed,
      failed: fixReport.failed,
      results: fixReport.fixes.map((f) => ({
        name: f.name,
        success: f.success,
        message: f.message,
      })),
    };
  }

  return JSON.stringify(output, null, 2);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function statusSymbol(check: DoctorCheckResult): string {
  if (check.passed) return "✔ pass";
  switch (check.severity) {
    case "error":
      return "✘ FAIL";
    case "warning":
      return "⚠ warn";
    case "info":
      return "- skip";
  }
}

/** Right-pad a string to a given width. */
function pad(str: string, width: number): string {
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}

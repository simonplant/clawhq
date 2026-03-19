/**
 * Output formatters for the PII + secrets scanner.
 *
 * Two modes:
 *   - Table: grouped by severity with redacted values for terminal display
 *   - JSON: structured output for scripting and automation
 */

import type { Finding, ScanReport } from "./types.js";

// ── Table Formatter ─────────────────────────────────────────────────────────

/**
 * Format a ScanReport as a grouped table for terminal output.
 *
 * Findings are grouped by severity (critical → low), then by file.
 * Values are always redacted — raw secrets never appear in output.
 */
export function formatScanTable(report: ScanReport): string {
  if (report.clean) {
    const parts = [`✔ No secrets or PII found (${report.filesScanned} files scanned)`];
    if (report.commitsScanned > 0) {
      parts.push(`  ${report.commitsScanned} git commits scanned`);
    }
    return parts.join("\n");
  }

  const lines: string[] = [];

  // File findings
  if (report.fileFindings.length > 0) {
    lines.push("── File Scan ──");
    lines.push("");
    lines.push(...formatFindings(report.fileFindings));
  }

  // Git findings
  if (report.gitFindings.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("── Git History ──");
    lines.push("");
    lines.push(...formatFindings(report.gitFindings));
  }

  // Summary
  lines.push("");
  lines.push(formatSummary(report));

  return lines.join("\n");
}

// ── JSON Formatter ──────────────────────────────────────────────────────────

/**
 * Format a ScanReport as JSON for scripting and automation.
 */
export function formatScanJson(report: ScanReport): string {
  return JSON.stringify(
    {
      timestamp: report.timestamp,
      scanRoot: report.scanRoot,
      clean: report.clean,
      summary: {
        filesScanned: report.filesScanned,
        commitsScanned: report.commitsScanned,
        totalFindings: report.findings.length,
        fileFindings: report.fileFindings.length,
        gitFindings: report.gitFindings.length,
        bySeverity: countBySeverity(report.findings),
      },
      findings: report.findings.map((f) => ({
        category: f.category,
        severity: f.severity,
        description: f.description,
        file: f.file,
        line: f.line ?? null,
        redacted: f.redacted,
        source: f.source,
        commit: f.commit ?? null,
      })),
    },
    null,
    2,
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;

const SEVERITY_SYMBOLS: Record<string, string> = {
  critical: "✘ CRIT",
  high: "✘ HIGH",
  medium: "⚠ MED ",
  low: "- LOW ",
};

function formatFindings(findings: readonly Finding[]): string[] {
  const lines: string[] = [];

  // Column widths
  const col1 = 9;  // severity symbol
  const col2 = Math.max(8, ...findings.map((f) => f.description.length)) + 2;

  // Group by severity
  for (const severity of SEVERITY_ORDER) {
    const group = findings.filter((f) => f.severity === severity);
    if (group.length === 0) continue;

    for (const f of group) {
      const symbol = SEVERITY_SYMBOLS[f.severity] ?? "?";
      const location = f.line != null ? `${f.file}:${f.line}` : f.file;
      const commitSuffix = f.commit ? ` (${f.commit.slice(0, 7)})` : "";

      lines.push(
        `  ${pad(symbol, col1)}${pad(f.description, col2)}${location}${commitSuffix}`,
      );
      lines.push(
        `  ${" ".repeat(col1)}${pad("", col2)}→ ${f.redacted}`,
      );
    }
  }

  return lines;
}

function formatSummary(report: ScanReport): string {
  const counts = countBySeverity(report.findings);
  const parts: string[] = [];

  if (counts.critical > 0) parts.push(`${counts.critical} critical`);
  if (counts.high > 0) parts.push(`${counts.high} high`);
  if (counts.medium > 0) parts.push(`${counts.medium} medium`);
  if (counts.low > 0) parts.push(`${counts.low} low`);

  const scope: string[] = [`${report.filesScanned} files`];
  if (report.commitsScanned > 0) scope.push(`${report.commitsScanned} commits`);

  return `✘ ${report.findings.length} finding(s): ${parts.join(", ")} (${scope.join(", ")} scanned)`;
}

function countBySeverity(
  findings: readonly Finding[],
): Record<string, number> {
  const counts: Record<string, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }
  return counts;
}

function pad(str: string, width: number): string {
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}

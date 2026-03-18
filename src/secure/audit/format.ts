/**
 * Egress audit formatter.
 *
 * Renders EgressAuditReport as:
 * - Human-readable table (default)
 * - JSON (--json)
 * - Signed export report (--export)
 * - Zero-egress attestation (--zero)
 */

import { createHash } from "node:crypto";

import type { EgressAuditReport } from "./egress.js";

// --- Helpers ---

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value < 10 && i > 0 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

function pad(str: string, width: number): string {
  return str.padEnd(width);
}

function formatTimestamp(ts: string): string {
  if (!ts) return "(unknown)";
  // Truncate to YYYY-MM-DD HH:MM:SS
  return ts.slice(0, 19).replace("T", " ");
}

function formatCost(cost: number | undefined): string {
  if (cost == null || cost === 0) return "-";
  return `$${cost.toFixed(4)}`;
}

// --- Table format ---

/**
 * Format the full egress audit as a human-readable table.
 */
export function formatEgressAuditTable(report: EgressAuditReport): string {
  const lines: string[] = [];
  const { summary, entries, drops } = report;

  // Header
  lines.push("==================================================");
  lines.push("  EGRESS AUDIT");
  lines.push("==================================================");

  const sinceLabel = report.since
    ? formatTimestamp(report.since)
    : "all time";
  lines.push(`  Period: ${sinceLabel} → ${formatTimestamp(report.until)}`);
  lines.push("");

  // Summary by provider
  lines.push("  PROVIDER SUMMARY");
  lines.push(`  ${"-".repeat(46)}`);
  lines.push(
    `  ${pad("PROVIDER", 14)}${pad("CALLS", 8)}${pad("BYTES", 10)}${pad("TOKENS IN", 11)}${pad("TOKENS OUT", 11)}COST`,
  );
  lines.push(`  ${"-".repeat(60)}`);

  const providers = Object.entries(summary.byProvider);
  if (providers.length === 0) {
    lines.push("  (no outbound API calls)");
  } else {
    for (const [name, ps] of providers) {
      lines.push(
        `  ${pad(name, 14)}${pad(String(ps.calls), 8)}${pad(formatBytes(ps.bytesOut), 10)}${pad(String(ps.tokensIn), 11)}${pad(String(ps.tokensOut), 11)}${formatCost(ps.cost)}`,
      );
    }
    lines.push(`  ${"-".repeat(60)}`);
    lines.push(
      `  ${pad("TOTAL", 14)}${pad(String(summary.totalCalls), 8)}${pad(formatBytes(summary.totalBytesOut), 10)}${pad(String(summary.totalTokensIn), 11)}${pad(String(summary.totalTokensOut), 11)}${formatCost(summary.totalCost)}`,
    );
  }
  lines.push("");

  // Detailed entries
  if (entries.length > 0) {
    lines.push("  CALL LOG");
    lines.push(`  ${"-".repeat(46)}`);
    lines.push(
      `  ${pad("TIMESTAMP", 21)}${pad("PROVIDER", 12)}${pad("MODEL", 16)}${pad("CATEGORY", 12)}${pad("BYTES", 10)}COST`,
    );
    lines.push(`  ${"-".repeat(77)}`);

    for (const entry of entries) {
      lines.push(
        `  ${pad(formatTimestamp(entry.timestamp), 21)}${pad(entry.provider, 12)}${pad(entry.model ?? "-", 16)}${pad(entry.dataCategory ?? "-", 12)}${pad(formatBytes(entry.bytesOut), 10)}${formatCost(entry.cost)}`,
      );
    }
    lines.push("");
  }

  // Dropped packets
  if (drops.length > 0) {
    lines.push("  BLOCKED PACKETS (firewall)");
    lines.push(`  ${"-".repeat(46)}`);
    lines.push(
      `  ${pad("TIMESTAMP", 24)}${pad("SRC", 18)}${pad("DST", 18)}${pad("PORT", 8)}PROTO`,
    );
    lines.push(`  ${"-".repeat(72)}`);

    for (const drop of drops) {
      lines.push(
        `  ${pad(drop.timestamp || "(unknown)", 24)}${pad(drop.srcIp ?? "-", 18)}${pad(drop.dstIp ?? "-", 18)}${pad(drop.dstPort != null ? String(drop.dstPort) : "-", 8)}${drop.protocol ?? "-"}`,
      );
    }
    lines.push("");
  }

  // Zero-egress badge
  if (summary.zeroEgress) {
    lines.push("  ** ZERO EGRESS ** No data sent to cloud providers");
  }

  lines.push(`  ${summary.totalCalls} call${summary.totalCalls === 1 ? "" : "s"}, ${summary.totalDrops} blocked packet${summary.totalDrops === 1 ? "" : "s"}`);

  return lines.join("\n");
}

// --- Export report ---

/**
 * Generate a signed egress audit report suitable for compliance export.
 *
 * The report includes a SHA-256 digest of the content for integrity
 * verification. (Full cryptographic signing would require GPG keys,
 * which is a future enhancement.)
 */
export function generateExportReport(report: EgressAuditReport): string {
  const lines: string[] = [];

  lines.push("CLAWHQ EGRESS AUDIT REPORT");
  lines.push("=".repeat(40));
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Period: ${report.since ?? "all time"} → ${report.until}`);
  lines.push("");

  lines.push("SUMMARY");
  lines.push("-".repeat(40));
  lines.push(`Total API calls:      ${report.summary.totalCalls}`);
  lines.push(`Total bytes out:      ${formatBytes(report.summary.totalBytesOut)}`);
  lines.push(`Total tokens in:      ${report.summary.totalTokensIn}`);
  lines.push(`Total tokens out:     ${report.summary.totalTokensOut}`);
  lines.push(`Total cost:           ${formatCost(report.summary.totalCost)}`);
  lines.push(`Blocked packets:      ${report.summary.totalDrops}`);
  lines.push(`Zero egress:          ${report.summary.zeroEgress ? "YES" : "NO"}`);
  lines.push("");

  if (Object.keys(report.summary.byProvider).length > 0) {
    lines.push("BY PROVIDER");
    lines.push("-".repeat(40));
    for (const [name, ps] of Object.entries(report.summary.byProvider)) {
      lines.push(`  ${name}: ${ps.calls} calls, ${formatBytes(ps.bytesOut)}, ${formatCost(ps.cost)}`);
    }
    lines.push("");
  }

  lines.push("ENTRIES");
  lines.push("-".repeat(40));
  for (const entry of report.entries) {
    lines.push(
      `  ${entry.timestamp} | ${entry.provider} | ${entry.model ?? "-"} | ${entry.dataCategory ?? "-"} | ${formatBytes(entry.bytesOut)} | ${formatCost(entry.cost)}`,
    );
  }
  if (report.entries.length === 0) {
    lines.push("  (none)");
  }
  lines.push("");

  if (report.drops.length > 0) {
    lines.push("BLOCKED");
    lines.push("-".repeat(40));
    for (const drop of report.drops) {
      lines.push(
        `  ${drop.timestamp} | ${drop.srcIp ?? "-"} → ${drop.dstIp ?? "-"}:${drop.dstPort ?? "-"} | ${drop.protocol ?? "-"}`,
      );
    }
    lines.push("");
  }

  // Compute integrity digest
  const content = lines.join("\n");
  const digest = createHash("sha256").update(content).digest("hex");

  lines.push("INTEGRITY");
  lines.push("-".repeat(40));
  lines.push(`SHA-256: ${digest}`);

  return lines.join("\n");
}

// --- Zero-egress attestation ---

/**
 * Generate a zero-egress attestation.
 *
 * Returns an attestation string if zero egress is confirmed,
 * or null if data was sent to cloud providers.
 */
export function generateZeroEgressAttestation(
  report: EgressAuditReport,
): string | null {
  if (!report.summary.zeroEgress) {
    return null;
  }

  const lines: string[] = [];
  lines.push("CLAWHQ ZERO-EGRESS ATTESTATION");
  lines.push("=".repeat(40));
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Period: ${report.since ?? "all time"} → ${report.until}`);
  lines.push("");
  lines.push("ATTESTATION: No data was sent to any cloud provider");
  lines.push("during the specified period.");
  lines.push("");
  lines.push(`API calls:        0`);
  lines.push(`Bytes out:        0 B`);
  lines.push(`Blocked packets:  ${report.summary.totalDrops}`);

  const content = lines.join("\n");
  const digest = createHash("sha256").update(content).digest("hex");

  lines.push("");
  lines.push(`SHA-256: ${digest}`);

  return lines.join("\n");
}

/**
 * Format the audit report as JSON (for --json flag).
 */
export function formatEgressAuditJson(report: EgressAuditReport): string {
  return JSON.stringify(report, null, 2);
}

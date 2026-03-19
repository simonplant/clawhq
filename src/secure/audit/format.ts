/**
 * Terminal formatters for the audit report.
 *
 * Two modes (matching doctor pattern):
 *   - Table: aligned columns for terminal display
 *   - JSON: structured output for scripting
 */

import type { AuditReport, ToolExecutionEvent } from "./types.js";

// ── Table Formatter ────────────────────────────────────────────────────────

/**
 * Format an AuditReport as a readable terminal table.
 *
 * Shows recent tool executions, egress events, and secret lifecycle events
 * with a summary footer.
 */
export function formatAuditTable(report: AuditReport): string {
  const lines: string[] = [];

  // ── Tool Executions ──
  lines.push("── Tool Executions ──");
  if (report.toolExecutions.length === 0) {
    lines.push("  No tool executions recorded.");
  } else {
    const col1 = 22; // timestamp
    const col2 = Math.max(6, ...report.toolExecutions.map((e) => e.tool.length)) + 2;
    const col3 = 10; // status

    lines.push(
      pad("Timestamp", col1) + pad("Tool", col2) + pad("Status", col3) + "Action",
    );
    lines.push(
      pad("─".repeat(col1 - 2), col1) +
        pad("─".repeat(col2 - 2), col2) +
        pad("─".repeat(col3 - 2), col3) +
        "─".repeat(30),
    );

    for (const e of report.toolExecutions) {
      const ts = formatTs(e.ts);
      const status = statusSymbol(e.status);
      lines.push(pad(ts, col1) + pad(e.tool, col2) + pad(status, col3) + truncate(e.action, 40));
    }
  }

  lines.push("");

  // ── Egress Events ──
  lines.push("── Egress Events ──");
  if (report.egressEvents.length === 0) {
    lines.push("  No egress events recorded.");
  } else {
    const col1 = 22;
    const col2 = Math.max(12, ...report.egressEvents.map((e) => e.destination.length)) + 2;
    const col3 = 10;

    lines.push(
      pad("Timestamp", col1) + pad("Destination", col2) + pad("Status", col3) + "Integration",
    );
    lines.push(
      pad("─".repeat(col1 - 2), col1) +
        pad("─".repeat(col2 - 2), col2) +
        pad("─".repeat(col3 - 2), col3) +
        "─".repeat(20),
    );

    for (const e of report.egressEvents) {
      const ts = formatTs(e.ts);
      const status = e.allowed ? "✔ allow" : "✘ block";
      lines.push(pad(ts, col1) + pad(e.destination, col2) + pad(status, col3) + e.integration);
    }
  }

  lines.push("");

  // ── Secret Lifecycle ──
  lines.push("── Secret Lifecycle ──");
  if (report.secretEvents.length === 0) {
    lines.push("  No secret lifecycle events recorded.");
  } else {
    const col1 = 22;
    const col2 = Math.max(10, ...report.secretEvents.map((e) => e.secretId.length)) + 2;
    const col3 = 10;

    lines.push(
      pad("Timestamp", col1) + pad("Secret", col2) + pad("Action", col3) + "Actor",
    );
    lines.push(
      pad("─".repeat(col1 - 2), col1) +
        pad("─".repeat(col2 - 2), col2) +
        pad("─".repeat(col3 - 2), col3) +
        "─".repeat(20),
    );

    for (const e of report.secretEvents) {
      const ts = formatTs(e.ts);
      lines.push(pad(ts, col1) + pad(e.secretId, col2) + pad(e.action, col3) + e.actor);
    }
  }

  lines.push("");

  // ── Summary ──
  lines.push("── Summary ──");
  const s = report.summary;
  lines.push(`  Tools:   ${s.totalToolExecutions} total (${s.successfulExecutions} ok, ${s.failedExecutions} failed)`);
  lines.push(`  Egress:  ${s.totalEgressEvents} total (${s.allowedEgress} allowed, ${s.blockedEgress} blocked)`);
  lines.push(`  Secrets: ${s.totalSecretEvents} events`);
  lines.push(`  Chain:   ${s.chainValid ? "✔ valid (tamper-evident)" : "✘ BROKEN — log may have been tampered with"}`);

  return lines.join("\n");
}

// ── JSON Formatter ─────────────────────────────────────────────────────────

/** Format an AuditReport as JSON for scripting. */
export function formatAuditJson(report: AuditReport): string {
  return JSON.stringify(report, null, 2);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function pad(str: string, width: number): string {
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}

function formatTs(iso: string): string {
  // Show date + time without milliseconds
  return iso.replace("T", " ").replace(/\.\d+Z$/, "Z").slice(0, 19);
}

function truncate(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max - 1) + "…";
}

function statusSymbol(status: ToolExecutionEvent["status"]): string {
  switch (status) {
    case "success":
      return "✔ ok";
    case "failure":
      return "✘ fail";
    case "timeout":
      return "⏱ timeout";
  }
}

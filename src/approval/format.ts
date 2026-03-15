/**
 * Approval queue formatter.
 *
 * Renders approval entries as human-readable table or JSON.
 */

import type { ApprovalEntry, ApprovalQueueSummary } from "./types.js";

function formatTimestamp(ts: string): string {
  if (!ts) return "(unknown)";
  return ts.slice(0, 19).replace("T", " ");
}

function pad(str: string, width: number): string {
  return str.padEnd(width);
}

function statusIcon(status: string): string {
  switch (status) {
    case "pending": return "?";
    case "approved": return "+";
    case "rejected": return "x";
    case "expired": return "-";
    default: return " ";
  }
}

/**
 * Format pending approvals as a human-readable table.
 */
export function formatApprovalTable(entries: ApprovalEntry[]): string {
  const lines: string[] = [];

  lines.push("==================================================");
  lines.push("  APPROVAL QUEUE");
  lines.push("==================================================");
  lines.push("");

  if (entries.length === 0) {
    lines.push("  (no pending approvals)");
    return lines.join("\n");
  }

  lines.push(
    `  ${pad("STATUS", 10)}${pad("CATEGORY", 16)}${pad("CREATED", 21)}DESCRIPTION`,
  );
  lines.push(`  ${"-".repeat(70)}`);

  for (const entry of entries) {
    const icon = statusIcon(entry.status);
    lines.push(
      `  [${icon}] ${pad(entry.category, 13)}${pad(formatTimestamp(entry.createdAt), 21)}${entry.description}`,
    );
    if (entry.id) {
      lines.push(`      ID: ${entry.id}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format the approval queue summary.
 */
export function formatApprovalSummary(summary: ApprovalQueueSummary): string {
  const lines: string[] = [];
  lines.push(`Approval queue: ${summary.pending} pending, ${summary.approved} approved, ${summary.rejected} rejected, ${summary.expired} expired (${summary.total} total)`);
  return lines.join("\n");
}

/**
 * Format approval entries as JSON.
 */
export function formatApprovalJson(entries: ApprovalEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

/**
 * Format a single approval entry for Telegram notification.
 */
export function formatApprovalTelegram(entry: ApprovalEntry): string {
  const lines: string[] = [];
  lines.push(`Approval Required: ${entry.category}`);
  lines.push("");
  lines.push(entry.description);
  if (entry.details) {
    lines.push("");
    lines.push(entry.details);
  }
  lines.push("");
  lines.push(`ID: ${entry.id}`);
  lines.push("");
  lines.push("Reply with:");
  lines.push(`  /approve ${entry.id}`);
  lines.push(`  /reject ${entry.id} [reason]`);
  return lines.join("\n");
}

/**
 * Digest formatter.
 *
 * Renders DigestReport as:
 * - Human-readable table (default)
 * - JSON (--json)
 */

import type { DigestReport } from "./types.js";

// --- Helpers ---

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value < 10 && i > 0 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

function formatTimestamp(ts: string): string {
  if (!ts) return "(unknown)";
  return ts.slice(0, 19).replace("T", " ");
}

// --- Table format ---

/**
 * Check if the digest has no data from any source.
 */
function isEmpty(report: DigestReport): boolean {
  return (
    report.totalEntries === 0 &&
    report.pendingApprovals.length === 0 &&
    report.cronRuns.length === 0 &&
    report.doctorWarnings.length === 0 &&
    report.egressSummary.zeroEgress
  );
}

/**
 * Format the digest report as a human-readable table.
 */
export function formatDigestTable(report: DigestReport): string {
  const lines: string[] = [];

  // Header
  lines.push("==================================================");
  lines.push("  ACTIVITY DIGEST");
  lines.push("==================================================");
  lines.push(`  Period: ${formatTimestamp(report.since)} → ${formatTimestamp(report.until)}`);
  if (report.privacyMode) {
    lines.push("  Mode: PRIVACY (category summaries only)");
  }
  lines.push("");

  // Friendly empty state
  if (isEmpty(report)) {
    lines.push("  No activity recorded yet.");
    lines.push("");
    lines.push("  Your agent hasn't logged any activity for this period.");
    lines.push("  Once the agent starts processing tasks, this digest will");
    lines.push("  show what it did, what it flagged, and what needs your attention.");
    return lines.join("\n");
  }

  // Tasks completed
  lines.push("  TASKS COMPLETED");
  lines.push(`  ${"-".repeat(46)}`);
  if (report.tasksCompleted.length === 0) {
    lines.push("  (none)");
  } else {
    for (const task of report.tasksCompleted) {
      lines.push(`  - ${task}`);
    }
  }
  lines.push("");

  // Pending approvals (from queue)
  lines.push("  PENDING APPROVAL");
  lines.push(`  ${"-".repeat(46)}`);
  if (report.pendingApprovals.length === 0 && report.tasksQueued.length === 0) {
    lines.push("  (none)");
  } else {
    for (const approval of report.pendingApprovals) {
      lines.push(`  - [${approval.category}] ${approval.description}`);
    }
    // Also show approval-requested entries from activity log not already in queue
    for (const task of report.tasksQueued) {
      lines.push(`  - ${task}`);
    }
  }
  lines.push("");

  // Problems found
  lines.push("  PROBLEMS FOUND");
  lines.push(`  ${"-".repeat(46)}`);
  if (report.problems.length === 0 && report.doctorWarnings.length === 0) {
    lines.push("  (none)");
  } else {
    for (const problem of report.problems) {
      lines.push(`  [${problem.category}] ${problem.problem}`);
      lines.push(`    Proposal: ${problem.proposal}`);
    }
    for (const warning of report.doctorWarnings) {
      lines.push(`  [doctor:${warning.status}] ${warning.name}: ${warning.message}`);
      lines.push(`    Fix: ${warning.fix}`);
    }
  }
  lines.push("");

  // Cron runs
  if (report.cronRuns.length > 0) {
    lines.push("  CRON RUNS");
    lines.push(`  ${"-".repeat(46)}`);
    for (const run of report.cronRuns) {
      const icon = run.status === "success" ? "+" : run.status === "failure" ? "!" : "?";
      const summary = run.summary ? ` — ${run.summary}` : "";
      lines.push(`  [${icon}] ${run.jobName} at ${formatTimestamp(run.ranAt)}${summary}`);
    }
    lines.push("");
  }

  // Category breakdown
  lines.push("  ACTIVITY BY CATEGORY");
  lines.push(`  ${"-".repeat(46)}`);
  if (report.categories.length === 0) {
    lines.push("  (no activity)");
  } else {
    for (const cat of report.categories) {
      lines.push(`  ${cat.category} (${cat.count})`);
      for (const highlight of cat.highlights) {
        lines.push(`    - ${highlight}`);
      }
    }
  }
  lines.push("");

  // Egress summary
  lines.push("  DATA EGRESS");
  lines.push(`  ${"-".repeat(46)}`);
  if (report.egressSummary.zeroEgress) {
    lines.push("  ** ZERO EGRESS ** No data sent to cloud providers");
  } else {
    lines.push(`  Calls: ${report.egressSummary.totalCalls}`);
    lines.push(`  Bytes out: ${formatBytes(report.egressSummary.totalBytesOut)}`);
    lines.push(`  Providers: ${report.egressSummary.providers.join(", ")}`);
  }
  lines.push("");

  // Footer
  lines.push(`  Total: ${report.totalEntries} activit${report.totalEntries === 1 ? "y" : "ies"} recorded`);

  return lines.join("\n");
}

/**
 * Format the digest report as JSON.
 */
export function formatDigestJson(report: DigestReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Alert report formatter.
 *
 * Renders alert reports as terminal tables or JSON for both the
 * `clawhq alerts` command and the status dashboard integration.
 */

import type { AlertReport, AlertSeverity, PredictiveAlert } from "./types.js";

// --- Helpers ---

const SEVERITY_LABELS: Record<AlertSeverity, string> = {
  critical: "CRIT",
  warning: "WARN",
  info: "INFO",
};

function pad(str: string, width: number): string {
  return str.padEnd(width);
}

function sectionHeader(title: string): string {
  return `\n${"=".repeat(50)}\n  ${title}\n${"=".repeat(50)}`;
}

// --- Single alert formatting ---

function formatAlertDetail(alert: PredictiveAlert): string {
  const lines: string[] = [];
  const sevLabel = SEVERITY_LABELS[alert.severity];

  lines.push(`  [${sevLabel}] ${alert.title}`);
  lines.push(`         ${alert.message}`);
  if (alert.projectedTimeline) {
    lines.push(`         Timeline: ${alert.projectedTimeline}`);
  }
  if (alert.remediation.length > 0) {
    lines.push(`         Fix: ${alert.remediation[0]}`);
    for (const step of alert.remediation.slice(1)) {
      lines.push(`              ${step}`);
    }
  }

  return lines.join("\n");
}

// --- Full report ---

/**
 * Format a full alert report as a terminal table.
 */
export function formatAlertTable(report: AlertReport): string {
  const lines: string[] = [sectionHeader("PREDICTIVE HEALTH ALERTS")];

  if (report.alerts.length === 0) {
    lines.push("  No alerts. All metrics stable.");
    lines.push("");
    lines.push(`  Tracking ${report.metricSummary.tracked} metrics, all stable.`);
    return lines.join("\n");
  }

  for (const alert of report.alerts) {
    lines.push(formatAlertDetail(alert));
    lines.push("");
  }

  // Summary
  lines.push("-".repeat(50));
  const parts: string[] = [];
  if (report.counts.critical > 0) parts.push(`${report.counts.critical} critical`);
  if (report.counts.warning > 0) parts.push(`${report.counts.warning} warning`);
  if (report.counts.info > 0) parts.push(`${report.counts.info} info`);
  lines.push(`  ${parts.join(", ")} | ${report.metricSummary.tracked} metrics tracked, ${report.metricSummary.trending} trending`);

  return lines.join("\n");
}

/**
 * Format alerts as a compact summary for the status dashboard.
 * Shows at most 3 highest-severity alerts.
 */
export function formatAlertSummary(report: AlertReport): string {
  const lines: string[] = [sectionHeader("ALERTS")];

  if (report.alerts.length === 0) {
    lines.push("  No active alerts");
    return lines.join("\n");
  }

  const sevWidth = 5;
  const catWidth = Math.max(8, ...report.alerts.slice(0, 3).map((a) => a.category.length));

  lines.push(`  ${pad("SEV", sevWidth)}  ${pad("CATEGORY", catWidth)}  MESSAGE`);
  lines.push(`  ${"-".repeat(sevWidth + catWidth + 30)}`);

  // Show top 3 alerts
  for (const alert of report.alerts.slice(0, 3)) {
    const sev = SEVERITY_LABELS[alert.severity];
    lines.push(`  ${pad(sev, sevWidth)}  ${pad(alert.category, catWidth)}  ${alert.title}`);
  }

  if (report.alerts.length > 3) {
    lines.push(`  ... and ${report.alerts.length - 3} more (run \`clawhq alerts\` for details)`);
  }

  return lines.join("\n");
}

/**
 * Format alert report as JSON.
 */
export function formatAlertJson(report: AlertReport): string {
  return JSON.stringify(report, null, 2);
}

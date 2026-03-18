/**
 * Repair runner — orchestrates detection and recovery.
 *
 * Runs all monitors, dispatches repair actions for detected issues,
 * logs all actions to the audit trail, and produces a RepairReport.
 */

import { repairIssue } from "./actions.js";
import { logRepairAction } from "./logger.js";
import { detectIssues } from "./monitor.js";
import type {
  RepairActionResult,
  RepairConfig,
  RepairContext,
  RepairReport,
} from "./types.js";
import { DEFAULT_REPAIR_CONFIG } from "./types.js";

/**
 * Check if a repair behavior is enabled for the given issue type.
 */
function isEnabled(
  issueType: string,
  config: RepairConfig,
): boolean {
  switch (issueType) {
    case "gateway_down":
      return config.gatewayRestart;
    case "network_drop":
      return config.networkReconnect;
    case "firewall_missing":
      return config.firewallReapply;
    default:
      return false;
  }
}

/**
 * Run all health monitors and attempt to repair any detected issues.
 *
 * Skips repair actions for behaviors disabled in config.
 * Logs all repair actions (including skipped ones) to the audit trail.
 */
export async function runRepair(
  ctx: RepairContext,
  config: RepairConfig = DEFAULT_REPAIR_CONFIG,
): Promise<RepairReport> {
  const issues = await detectIssues(ctx);

  if (issues.length === 0) {
    return { issues: [], actions: [], allHealthy: true };
  }

  const actions: RepairActionResult[] = [];

  for (const issue of issues) {
    let result: RepairActionResult;

    if (!isEnabled(issue.type, config)) {
      result = {
        issue: issue.type,
        status: "skipped",
        action: `Auto-repair disabled for ${issue.type}`,
        message: `Skipped: ${issue.type} repair is disabled in config`,
        durationMs: 0,
      };
    } else {
      result = await repairIssue(issue, ctx);
    }

    actions.push(result);

    // Log to audit trail
    await logRepairAction(ctx.openclawHome, result);
  }

  const allHealthy = actions.every(
    (a) => a.status === "repaired" || a.status === "skipped",
  );

  return { issues, actions, allHealthy };
}

// --- Output formatting ---

export function formatRepairReport(report: RepairReport): string {
  if (report.issues.length === 0) {
    return "All systems healthy. No repairs needed.";
  }

  const lines: string[] = [];

  // Header
  const nameWidth = Math.max(
    6,
    ...report.actions.map((a) => a.action.length),
  );
  const statusWidth = 8;

  lines.push(
    `${"ACTION".padEnd(nameWidth)}  ${"STATUS".padEnd(statusWidth)}  MESSAGE`,
  );
  lines.push("-".repeat(nameWidth + statusWidth + nameWidth + 10));

  // Rows
  for (const action of report.actions) {
    const statusLabel = action.status.toUpperCase();
    const duration = action.durationMs > 0 ? ` (${action.durationMs}ms)` : "";
    lines.push(
      `${action.action.padEnd(nameWidth)}  ${statusLabel.padEnd(statusWidth)}  ${action.message}${duration}`,
    );
  }

  // Summary
  lines.push("");
  const repaired = report.actions.filter((a) => a.status === "repaired").length;
  const failed = report.actions.filter((a) => a.status === "failed").length;
  const skipped = report.actions.filter((a) => a.status === "skipped").length;
  lines.push(`${repaired} repaired, ${failed} failed, ${skipped} skipped`);

  return lines.join("\n");
}

export function formatRepairJson(report: RepairReport): string {
  return JSON.stringify(report, null, 2);
}

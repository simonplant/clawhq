/**
 * Terminal formatting for update intelligence reports.
 *
 * Renders ChangeIntelligenceReport and MigrationPlan as human-readable
 * terminal output for `clawhq update --check`.
 */

import type { MigrationPlan } from "./migrations/types.js";
import type { ChangeIntelligenceReport } from "./types.js";

// ── Public API ─────────────────────────────────────────────────────────────

/** Format a ChangeIntelligenceReport for terminal display. */
export function formatIntelligenceReport(
  report: ChangeIntelligenceReport,
  currentVersion: string,
  targetVersion: string,
): string {
  const lines: string[] = [];

  // Header
  lines.push(`Update: ${currentVersion} → ${targetVersion}`);
  lines.push(`Classification: ${formatClassification(report.classification)}`);
  lines.push(`Upstream commits: ${report.commitCount}`);

  // Impact areas
  if (report.impactAreas.length > 0) {
    lines.push(`Impact areas: ${report.impactAreas.join(", ")}`);
  }

  // Breakage risk
  if (report.hasBreakageRisk) {
    lines.push("");
    lines.push("WARNING: Config breakage risk detected for your deployment");
  }

  // Migration plan
  if (report.migrationPlan) {
    lines.push("");
    lines.push(formatMigrationPlan(report.migrationPlan));
  }

  // Recommendation
  lines.push("");
  lines.push(`Recommendation: ${formatAction(report.recommendation.action)}`);
  lines.push(`  ${report.recommendation.reason}`);

  if (report.recommendation.risks.length > 0) {
    lines.push("  Risks:");
    for (const risk of report.recommendation.risks) {
      lines.push(`    - ${risk}`);
    }
  }

  return lines.join("\n");
}

/** Format a MigrationPlan summary for terminal display. */
export function formatMigrationPlan(plan: MigrationPlan): string {
  const lines: string[] = [];

  lines.push(`Migrations: ${plan.migrations.length} (${plan.fromVersion} → ${plan.toVersion})`);

  for (const migration of plan.migrations) {
    lines.push(`  ${migration.id}: ${migration.description}`);
    for (const change of migration.changes) {
      lines.push(`    ${change.type}: ${change.path} — ${change.description}`);
    }
  }

  if (plan.hasBreakingChanges) {
    lines.push("  NOTE: Includes breaking changes (compose/schema modifications)");
  }

  return lines.join("\n");
}

/** Format intelligence report as JSON for scripting. */
export function formatIntelligenceJson(report: ChangeIntelligenceReport): string {
  return JSON.stringify({
    classification: report.classification,
    commitCount: report.commitCount,
    impactAreas: report.impactAreas,
    hasBreakageRisk: report.hasBreakageRisk,
    migrationsRequired: report.migrationPlan?.migrations.length ?? 0,
    recommendation: report.recommendation,
  }, null, 2);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatClassification(c: ChangeIntelligenceReport["classification"]): string {
  switch (c) {
    case "security-patch": return "SECURITY PATCH";
    case "bugfix": return "Bug Fix";
    case "feature": return "Feature Release";
    case "breaking": return "BREAKING CHANGE";
  }
}

function formatAction(action: ChangeIntelligenceReport["recommendation"]["action"]): string {
  switch (action) {
    case "update-now": return "UPDATE NOW";
    case "update-soon": return "Update Soon";
    case "wait": return "Wait";
    case "hold": return "HOLD — Review Required";
  }
}

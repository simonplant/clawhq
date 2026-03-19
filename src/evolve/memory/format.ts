/**
 * Formatters for memory status, lifecycle results, and preference reports.
 */

import chalk from "chalk";

import type {
  LifecycleRunResult,
  MemoryStatus,
  PreferenceReport,
} from "./types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function tierColor(tier: string): (s: string) => string {
  switch (tier) {
    case "hot":
      return chalk.red;
    case "warm":
      return chalk.yellow;
    case "cold":
      return chalk.blue;
    default:
      return chalk.white;
  }
}

// ── Memory Status ────────────────────────────────────────────────────────────

export function formatMemoryStatus(status: MemoryStatus): string {
  const lines: string[] = [];

  lines.push(chalk.bold("Memory Tiers"));
  lines.push("");

  for (const ts of status.tiers) {
    const color = tierColor(ts.tier);
    const bar = "█".repeat(Math.min(30, Math.ceil(ts.entryCount * 3)));
    lines.push(
      `  ${color(ts.tier.toUpperCase().padEnd(5))} ${String(ts.entryCount).padStart(3)} entries  ${formatBytes(ts.totalSizeBytes).padStart(10)}  ${chalk.dim(bar)}`,
    );
  }

  lines.push("");
  lines.push(
    `  Total: ${status.totalEntries} entries, ${formatBytes(status.totalSizeBytes)}`,
  );

  if (status.lastRunAt) {
    lines.push(`  Last lifecycle run: ${status.lastRunAt}`);
  }

  lines.push("");
  lines.push(chalk.dim("  Config:"));
  lines.push(
    chalk.dim(
      `    Hot retention: ${status.config.hotRetentionHours}h | Warm retention: ${status.config.warmRetentionHours}h`,
    ),
  );
  lines.push(
    chalk.dim(
      `    Cold retention: ${status.config.coldRetentionHours === 0 ? "forever" : `${status.config.coldRetentionHours}h`} | Summarization: ${status.config.summarization}`,
    ),
  );
  lines.push(
    chalk.dim(
      `    Hot max: ${formatBytes(status.config.hotMaxBytes)}`,
    ),
  );

  return lines.join("\n");
}

export function formatMemoryStatusJson(status: MemoryStatus): string {
  return JSON.stringify(status, null, 2);
}

// ── Lifecycle Result ─────────────────────────────────────────────────────────

export function formatLifecycleResult(result: LifecycleRunResult): string {
  const lines: string[] = [];

  if (!result.success) {
    lines.push(chalk.red(`Lifecycle run failed: ${result.error}`));
    return lines.join("\n");
  }

  lines.push(chalk.bold("Memory Lifecycle Complete"));
  lines.push("");

  if (result.transitions.length === 0 && result.purged.length === 0) {
    lines.push(chalk.dim("  No transitions needed."));
  } else {
    for (const t of result.transitions) {
      const arrow = `${tierColor(t.fromTier)(t.fromTier)} → ${tierColor(t.toTier)(t.toTier)}`;
      const flags = [
        t.summarized ? chalk.green("summarized") : null,
        t.piiMasked ? chalk.cyan("PII masked") : null,
      ]
        .filter(Boolean)
        .join(", ");

      lines.push(`  ${t.entryId}: ${arrow}  ${formatBytes(t.newSizeBytes)}  ${flags}`);
    }

    if (result.purged.length > 0) {
      lines.push("");
      lines.push(
        chalk.dim(`  Purged ${result.purged.length}: ${result.purged.join(", ")}`),
      );
    }
  }

  lines.push("");
  lines.push(
    `  Hot: ${formatBytes(result.hotSizeBytes)} | Warm: ${formatBytes(result.warmSizeBytes)} | Cold: ${formatBytes(result.coldSizeBytes)}`,
  );
  lines.push(`  Total entries: ${result.totalEntries}`);

  return lines.join("\n");
}

export function formatLifecycleResultJson(result: LifecycleRunResult): string {
  return JSON.stringify(result, null, 2);
}

// ── Preference Report ────────────────────────────────────────────────────────

export function formatPreferenceReport(report: PreferenceReport): string {
  const lines: string[] = [];

  lines.push(chalk.bold("Agent Preference Patterns"));
  lines.push("");

  if (report.patterns.length === 0) {
    lines.push(
      chalk.dim("  No patterns detected yet. More decision history needed."),
    );
    lines.push(
      chalk.dim(`  Total decisions tracked: ${report.totalDecisions}`),
    );
    return lines.join("\n");
  }

  for (const p of report.patterns) {
    const confidence = Math.round(p.confidence * 100);
    const confidenceColor =
      confidence >= 80 ? chalk.green : confidence >= 60 ? chalk.yellow : chalk.dim;

    lines.push(
      `  ${chalk.bold(p.category.toUpperCase())}  ${confidenceColor(`${confidence}% confidence`)}  (${p.supportCount} decisions)`,
    );
    lines.push(`    ${p.description}`);
    lines.push(
      chalk.dim(`    First seen: ${p.detectedAt.split("T")[0]}  Last: ${p.lastSeenAt.split("T")[0]}`),
    );
    lines.push("");
  }

  lines.push(
    `  Tracked since: ${report.trackedSince.split("T")[0]} | Total decisions: ${report.totalDecisions}`,
  );

  return lines.join("\n");
}

export function formatPreferenceReportJson(report: PreferenceReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Identity review — interactive review flow for `clawhq evolve identity`.
 *
 * Shows budget per file, staleness, consistency, and supports editing
 * individual identity files with diff preview before saving.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { mergeCustomizations } from "./customizations.js";
import { checkBudget, checkStaleness, checkConsistency } from "./governance.js";
import type { BudgetReport, IdentityContext, IdentityGovernanceConfig, StalenessReport } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IdentityFileStatus {
  filename: string;
  path: string;
  tokenCount: number;
  budgetPercent: number;
  daysSinceUpdate: number;
  stale: boolean;
  lastModified: Date;
}

export interface ReviewSummary {
  files: IdentityFileStatus[];
  totalTokens: number;
  budgetLimit: number;
  budgetPercent: number;
  threshold: string;
  staleCount: number;
  contradictionCount: number;
  contradictions: string[];
}

// ---------------------------------------------------------------------------
// Review summary
// ---------------------------------------------------------------------------

/**
 * Build a combined review summary from budget, staleness, and consistency checks.
 */
export async function buildReviewSummary(
  ctx: IdentityContext,
  config?: IdentityGovernanceConfig,
): Promise<ReviewSummary> {
  const [budget, staleness, consistency] = await Promise.all([
    checkBudget(ctx, config),
    checkStaleness(ctx, config),
    checkConsistency(ctx),
  ]);

  const files = mergeFileStatus(budget, staleness);

  return {
    files,
    totalTokens: budget.totalTokens,
    budgetLimit: budget.budgetLimit,
    budgetPercent: budget.budgetPercent,
    threshold: budget.threshold,
    staleCount: staleness.staleCount,
    contradictionCount: consistency.contradictions.length,
    contradictions: consistency.contradictions.map(
      (c) =>
        c.fileA === c.fileB
          ? `[${c.fileA}] ${c.description}`
          : `[${c.fileA} <-> ${c.fileB}] ${c.description}`,
    ),
  };
}

function mergeFileStatus(
  budget: BudgetReport,
  staleness: StalenessReport,
): IdentityFileStatus[] {
  const stalenessMap = new Map(
    staleness.entries.map((e) => [e.filename, e]),
  );

  return budget.files.map((f) => {
    const s = stalenessMap.get(f.filename);
    return {
      filename: f.filename,
      path: f.path,
      tokenCount: f.tokenCount,
      budgetPercent: f.budgetPercent,
      daysSinceUpdate: s?.daysSinceUpdate ?? 0,
      stale: s?.stale ?? false,
      lastModified: s?.lastModified ?? new Date(),
    };
  });
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatReviewSummary(summary: ReviewSummary): string {
  const lines: string[] = [];
  lines.push("Identity Governance Review");
  lines.push("=========================");
  lines.push("");

  if (summary.files.length === 0) {
    lines.push("No identity files found.");
    return lines.join("\n");
  }

  const nameWidth = Math.max(
    8,
    ...summary.files.map((f) => f.filename.length),
  );

  lines.push(
    `${"FILE".padEnd(nameWidth)}  ${"TOKENS".padStart(8)}  ${"BUDGET %".padStart(8)}  ${"DAYS AGO".padStart(8)}  STATUS`,
  );
  lines.push("-".repeat(nameWidth + 44));

  // Sort by token count descending
  const sorted = [...summary.files].sort(
    (a, b) => b.tokenCount - a.tokenCount,
  );
  for (const f of sorted) {
    const status = f.stale ? "STALE" : "OK";
    lines.push(
      `${f.filename.padEnd(nameWidth)}  ${String(f.tokenCount).padStart(8)}  ${f.budgetPercent.toFixed(1).padStart(7)}%  ${String(f.daysSinceUpdate).padStart(8)}  ${status}`,
    );
  }

  lines.push("-".repeat(nameWidth + 44));
  lines.push(
    `${"TOTAL".padEnd(nameWidth)}  ${String(summary.totalTokens).padStart(8)}  ${summary.budgetPercent.toFixed(1).padStart(7)}%`,
  );
  lines.push("");
  lines.push(
    `Budget: ${summary.totalTokens} / ${summary.budgetLimit} tokens (${summary.threshold})`,
  );

  if (summary.staleCount > 0) {
    lines.push(
      `Stale files: ${summary.staleCount} (not updated in 30+ days)`,
    );
  }

  if (summary.contradictionCount > 0) {
    lines.push("");
    lines.push(`Contradictions: ${summary.contradictionCount}`);
    for (const c of summary.contradictions) {
      lines.push(`  - ${c}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/**
 * Generate a simple unified-style diff between two strings.
 * Returns null if contents are identical.
 */
export function simpleDiff(
  original: string,
  modified: string,
  filename: string,
): string | null {
  if (original === modified) return null;

  const oldLines = original.split("\n");
  const newLines = modified.split("\n");
  const lines: string[] = [];

  lines.push(`--- a/${filename}`);
  lines.push(`+++ b/${filename}`);

  // Simple line-by-line comparison
  const maxLen = Math.max(oldLines.length, newLines.length);
  let contextStart = -1;
  let hunkLines: string[] = [];

  function flushHunk(): void {
    if (hunkLines.length > 0) {
      lines.push(`@@ -${contextStart + 1} +${contextStart + 1} @@`);
      lines.push(...hunkLines);
      hunkLines = [];
    }
  }

  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined;
    const newLine = i < newLines.length ? newLines[i] : undefined;

    if (oldLine === newLine) {
      if (hunkLines.length > 0) {
        hunkLines.push(` ${oldLine ?? ""}`);
        // After 3 context lines, flush the hunk
        const contextCount = hunkLines.filter((l) => l.startsWith(" ")).length;
        if (contextCount >= 3) {
          flushHunk();
        }
      }
      continue;
    }

    if (contextStart === -1 || hunkLines.length === 0) {
      contextStart = Math.max(0, i - 1);
      // Add one line of leading context
      if (i > 0 && i - 1 < oldLines.length) {
        hunkLines.push(` ${oldLines[i - 1]}`);
      }
    }

    if (oldLine !== undefined && newLine === undefined) {
      hunkLines.push(`-${oldLine}`);
    } else if (oldLine === undefined && newLine !== undefined) {
      hunkLines.push(`+${newLine}`);
    } else {
      hunkLines.push(`-${oldLine}`);
      hunkLines.push(`+${newLine}`);
    }
  }

  flushHunk();

  return lines.length > 2 ? lines.join("\n") : null;
}

// ---------------------------------------------------------------------------
// File save with customizations merge
// ---------------------------------------------------------------------------

/**
 * Save an edited identity file, preserving customizations from the original.
 * Returns the diff string or null if no changes.
 */
export async function saveIdentityFile(
  filePath: string,
  newContent: string,
): Promise<{ diff: string | null; saved: boolean }> {
  let originalContent: string;
  try {
    originalContent = await readFile(filePath, "utf-8");
  } catch {
    originalContent = "";
  }

  // Merge customizations from the original into the new content
  const merged = originalContent
    ? mergeCustomizations(newContent, originalContent)
    : newContent;

  const diff = simpleDiff(originalContent, merged, filePath.split("/").pop() ?? "file");

  if (!diff) {
    return { diff: null, saved: false };
  }

  await writeFile(filePath, merged, "utf-8");
  return { diff, saved: true };
}

/**
 * Read an identity file's current content.
 */
export async function readIdentityFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Get the full path to an identity file in the workspace.
 */
export function identityFilePath(
  ctx: IdentityContext,
  filename: string,
): string {
  return join(ctx.openclawHome, "workspace", filename);
}

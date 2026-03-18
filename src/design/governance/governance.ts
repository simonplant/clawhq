/**
 * Identity governance — token budget tracking, staleness detection,
 * and consistency checking for identity files.
 *
 * Identity files live in {openclawHome}/workspace/ and control the
 * agent's personality, operating instructions, and guardrails.
 * This module tracks their health to prevent drift and bloat.
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type {
  BudgetReport,
  ConsistencyReport,
  Contradiction,
  FileTokenReport,
  IdentityContext,
  IdentityGovernanceConfig,
  IdentityReport,
  StalenessEntry,
  StalenessReport,
  ThresholdLevel,
} from "./types.js";

/** Identity files to track in the workspace. */
const IDENTITY_FILES = [
  "SOUL.md",
  "USER.md",
  "AGENTS.md",
  "TOOLS.md",
  "HEARTBEAT.md",
  "IDENTITY.md",
  "BOOT.md",
  "BOOTSTRAP.md",
  "MEMORY.md",
];

const DEFAULT_BUDGET_LIMIT = 20_000;
const DEFAULT_WARNING_THRESHOLD = 0.7;
const DEFAULT_CRITICAL_THRESHOLD = 0.9;
const DEFAULT_STALE_DAYS = 30;

// --- Token estimation ---

/**
 * Estimate token count from text content using word-based heuristic.
 * Approximation: ~1.33 tokens per word (GPT-family average).
 * This is intentionally conservative to avoid false negatives.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Split on whitespace and filter empty entries
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  // ~1.33 tokens per word is a standard approximation
  return Math.ceil(words.length * 1.33);
}

// --- Budget tracking ---

export async function checkBudget(
  ctx: IdentityContext,
  config?: IdentityGovernanceConfig,
): Promise<BudgetReport> {
  const budgetLimit = config?.budgetLimit ?? DEFAULT_BUDGET_LIMIT;
  const warningThreshold = config?.warningThreshold ?? DEFAULT_WARNING_THRESHOLD;
  const criticalThreshold = config?.criticalThreshold ?? DEFAULT_CRITICAL_THRESHOLD;

  const workspacePath = join(ctx.openclawHome, "workspace");
  const files: FileTokenReport[] = [];

  for (const filename of IDENTITY_FILES) {
    const filePath = join(workspacePath, filename);
    try {
      const content = await readFile(filePath, "utf-8");
      const tokenCount = estimateTokens(content);
      files.push({
        filename,
        path: filePath,
        tokenCount,
        budgetPercent: 0, // filled after total is known
      });
    } catch {
      // File doesn't exist — skip
    }
  }

  const totalTokens = files.reduce((sum, f) => sum + f.tokenCount, 0);

  // Fill per-file budget percentages
  for (const f of files) {
    f.budgetPercent = budgetLimit > 0 ? (f.tokenCount / budgetLimit) * 100 : 0;
  }

  const budgetPercent = budgetLimit > 0 ? (totalTokens / budgetLimit) * 100 : 0;
  const budgetFraction = budgetLimit > 0 ? totalTokens / budgetLimit : 0;

  let threshold: ThresholdLevel = "ok";
  if (budgetFraction >= criticalThreshold) {
    threshold = "critical";
  } else if (budgetFraction >= warningThreshold) {
    threshold = "warning";
  }

  return {
    files,
    totalTokens,
    budgetLimit,
    budgetPercent,
    threshold,
  };
}

// --- Staleness detection ---

export async function checkStaleness(
  ctx: IdentityContext,
  config?: IdentityGovernanceConfig,
): Promise<StalenessReport> {
  const staleDays = config?.staleDays ?? DEFAULT_STALE_DAYS;
  const workspacePath = join(ctx.openclawHome, "workspace");
  const now = new Date();
  const entries: StalenessEntry[] = [];

  for (const filename of IDENTITY_FILES) {
    const filePath = join(workspacePath, filename);
    try {
      const s = await stat(filePath);
      const daysSinceUpdate = Math.floor(
        (now.getTime() - s.mtime.getTime()) / (1000 * 60 * 60 * 24),
      );
      entries.push({
        filename,
        path: filePath,
        lastModified: s.mtime,
        daysSinceUpdate,
        stale: daysSinceUpdate >= staleDays,
      });
    } catch {
      // File doesn't exist — skip
    }
  }

  const staleCount = entries.filter((e) => e.stale).length;

  return {
    entries,
    staleCount,
    staleDaysThreshold: staleDays,
  };
}

// --- Consistency checking ---

/**
 * Check identity files for potential contradictions using heuristic patterns.
 *
 * Looks for conflicting directives like:
 * - One file says "never" while another says "always" about the same topic
 * - Conflicting autonomy levels (autonomous vs. ask-first)
 * - Duplicate/conflicting persona definitions
 */
export async function checkConsistency(
  ctx: IdentityContext,
): Promise<ConsistencyReport> {
  const workspacePath = join(ctx.openclawHome, "workspace");
  const fileContents: Map<string, string> = new Map();

  for (const filename of IDENTITY_FILES) {
    const filePath = join(workspacePath, filename);
    try {
      const content = await readFile(filePath, "utf-8");
      fileContents.set(filename, content.toLowerCase());
    } catch {
      // File doesn't exist — skip
    }
  }

  const contradictions: Contradiction[] = [];

  // Check for conflicting autonomy signals
  checkAutonomyConflicts(fileContents, contradictions);

  // Check for conflicting behavioral directives
  checkBehavioralConflicts(fileContents, contradictions);

  // Check for duplicate name/persona definitions
  checkDuplicatePersona(fileContents, contradictions);

  return {
    contradictions,
    filesChecked: fileContents.size,
  };
}

// --- Consistency heuristic helpers ---

const AUTONOMOUS_PATTERNS = [
  /act\s+autonomously/,
  /without\s+asking/,
  /don't\s+ask\s+(for\s+)?permission/,
  /auto[-\s]?approve/,
];

const ASK_FIRST_PATTERNS = [
  /always\s+ask\s+(for\s+)?(permission|approval|confirmation)/,
  /never\s+act\s+without\s+(permission|approval)/,
  /require[s]?\s+(approval|confirmation)/,
];

function checkAutonomyConflicts(
  files: Map<string, string>,
  contradictions: Contradiction[],
): void {
  const autonomousFiles: string[] = [];
  const askFirstFiles: string[] = [];

  for (const [filename, content] of files) {
    if (AUTONOMOUS_PATTERNS.some((p) => p.test(content))) {
      autonomousFiles.push(filename);
    }
    if (ASK_FIRST_PATTERNS.some((p) => p.test(content))) {
      askFirstFiles.push(filename);
    }
  }

  // If same file has both — contradiction within file
  for (const file of autonomousFiles) {
    if (askFirstFiles.includes(file)) {
      contradictions.push({
        fileA: file,
        fileB: file,
        description: "Contains both autonomous-action and ask-first directives",
      });
    }
  }

  // Cross-file contradictions
  if (autonomousFiles.length > 0 && askFirstFiles.length > 0) {
    for (const autoFile of autonomousFiles) {
      for (const askFile of askFirstFiles) {
        if (autoFile !== askFile) {
          contradictions.push({
            fileA: autoFile,
            fileB: askFile,
            description:
              `${autoFile} promotes autonomous action while ${askFile} requires asking permission`,
          });
        }
      }
    }
  }
}

const NEVER_DO_RE = /never\s+(\w+(?:\s+\w+){0,3})/g;
const ALWAYS_DO_RE = /always\s+(\w+(?:\s+\w+){0,3})/g;

function checkBehavioralConflicts(
  files: Map<string, string>,
  contradictions: Contradiction[],
): void {
  // Collect "never X" and "always X" across files
  const neverMap: Map<string, string[]> = new Map();
  const alwaysMap: Map<string, string[]> = new Map();

  for (const [filename, content] of files) {
    for (const match of content.matchAll(NEVER_DO_RE)) {
      const action = match[1].trim();
      if (!neverMap.has(action)) neverMap.set(action, []);
      const arr = neverMap.get(action);
      if (arr) arr.push(filename);
    }
    for (const match of content.matchAll(ALWAYS_DO_RE)) {
      const action = match[1].trim();
      if (!alwaysMap.has(action)) alwaysMap.set(action, []);
      const arr = alwaysMap.get(action);
      if (arr) arr.push(filename);
    }
  }

  // Find actions that appear in both "never" and "always"
  for (const [action, neverFiles] of neverMap) {
    const alwaysFiles = alwaysMap.get(action);
    if (alwaysFiles) {
      for (const nf of neverFiles) {
        for (const af of alwaysFiles) {
          contradictions.push({
            fileA: nf,
            fileB: af,
            description: `Conflicting directives: "never ${action}" vs "always ${action}"`,
          });
        }
      }
    }
  }
}

const NAME_PATTERNS = [
  /(?:^|\n)#\s+(?:i\s+am|my\s+name\s+is|name:\s*)\s*(\S+)/,
  /(?:^|\n)you\s+are\s+(\S+)/,
  /(?:^|\n)agent\s+name:\s*(\S+)/,
];

function checkDuplicatePersona(
  files: Map<string, string>,
  contradictions: Contradiction[],
): void {
  const namesByFile: Map<string, string[]> = new Map();

  for (const [filename, content] of files) {
    const names: string[] = [];
    for (const pattern of NAME_PATTERNS) {
      const match = pattern.exec(content);
      if (match?.[1]) {
        names.push(match[1]);
      }
    }
    if (names.length > 0) {
      namesByFile.set(filename, names);
    }
  }

  // Check for different names across files
  const allNames = new Set<string>();
  const fileEntries = [...namesByFile.entries()];
  for (const [, names] of fileEntries) {
    for (const name of names) {
      allNames.add(name);
    }
  }

  if (allNames.size > 1) {
    const nameList = [...allNames].join(", ");
    for (let i = 0; i < fileEntries.length; i++) {
      for (let j = i + 1; j < fileEntries.length; j++) {
        const [fileA, namesA] = fileEntries[i];
        const [fileB, namesB] = fileEntries[j];
        const overlap = namesA.some((n) => namesB.includes(n));
        if (!overlap) {
          contradictions.push({
            fileA,
            fileB,
            description: `Different agent names defined: ${nameList}`,
          });
        }
      }
    }
  }
}

// --- Full governance check ---

export async function runGovernanceCheck(
  ctx: IdentityContext,
  config?: IdentityGovernanceConfig,
): Promise<IdentityReport> {
  const [budget, staleness, consistency] = await Promise.all([
    checkBudget(ctx, config),
    checkStaleness(ctx, config),
    checkConsistency(ctx),
  ]);

  return { budget, staleness, consistency };
}

// --- Formatting ---

export function formatBudgetReport(report: BudgetReport): string {
  const lines: string[] = [];
  lines.push("Identity Token Budget");
  lines.push("=====================");
  lines.push("");

  if (report.files.length === 0) {
    lines.push("No identity files found.");
    return lines.join("\n");
  }

  const nameWidth = Math.max(8, ...report.files.map((f) => f.filename.length));

  lines.push(
    `${"FILE".padEnd(nameWidth)}  ${"TOKENS".padStart(8)}  ${"BUDGET %".padStart(8)}`,
  );
  lines.push("-".repeat(nameWidth + 22));

  // Sort by token count descending
  const sorted = [...report.files].sort((a, b) => b.tokenCount - a.tokenCount);
  for (const f of sorted) {
    lines.push(
      `${f.filename.padEnd(nameWidth)}  ${String(f.tokenCount).padStart(8)}  ${f.budgetPercent.toFixed(1).padStart(7)}%`,
    );
  }

  lines.push("-".repeat(nameWidth + 22));
  lines.push(
    `${"TOTAL".padEnd(nameWidth)}  ${String(report.totalTokens).padStart(8)}  ${report.budgetPercent.toFixed(1).padStart(7)}%`,
  );
  lines.push("");
  lines.push(`Budget: ${report.totalTokens} / ${report.budgetLimit} tokens`);

  if (report.threshold === "critical") {
    lines.push(`WARNING: Token budget at ${report.budgetPercent.toFixed(0)}% — exceeds 90% threshold!`);
    lines.push("Consider trimming identity files to improve agent performance.");
  } else if (report.threshold === "warning") {
    lines.push(`NOTICE: Token budget at ${report.budgetPercent.toFixed(0)}% — exceeds 70% threshold.`);
    lines.push("Monitor identity file growth to avoid performance degradation.");
  }

  return lines.join("\n");
}

export function formatStalenessReport(report: StalenessReport): string {
  const lines: string[] = [];
  lines.push("Identity Staleness");
  lines.push("==================");
  lines.push("");

  if (report.entries.length === 0) {
    lines.push("No identity files found.");
    return lines.join("\n");
  }

  const nameWidth = Math.max(8, ...report.entries.map((e) => e.filename.length));

  lines.push(
    `${"FILE".padEnd(nameWidth)}  ${"LAST MODIFIED".padEnd(12)}  ${"DAYS AGO".padStart(8)}  STATUS`,
  );
  lines.push("-".repeat(nameWidth + 40));

  for (const e of report.entries) {
    const dateStr = e.lastModified.toISOString().slice(0, 10);
    const status = e.stale ? "STALE" : "OK";
    lines.push(
      `${e.filename.padEnd(nameWidth)}  ${dateStr.padEnd(12)}  ${String(e.daysSinceUpdate).padStart(8)}  ${status}`,
    );
  }

  lines.push("");
  lines.push(`Threshold: ${report.staleDaysThreshold} days`);
  if (report.staleCount > 0) {
    lines.push(`${report.staleCount} file(s) haven't been updated in ${report.staleDaysThreshold}+ days.`);
    lines.push("Run `clawhq evolve --identity` to review and update stale files.");
  }

  return lines.join("\n");
}

export function formatConsistencyReport(report: ConsistencyReport): string {
  const lines: string[] = [];
  lines.push("Identity Consistency");
  lines.push("====================");
  lines.push("");

  if (report.filesChecked === 0) {
    lines.push("No identity files found.");
    return lines.join("\n");
  }

  if (report.contradictions.length === 0) {
    lines.push(`Checked ${report.filesChecked} file(s) — no contradictions found.`);
    return lines.join("\n");
  }

  lines.push(`Found ${report.contradictions.length} potential contradiction(s):`);
  lines.push("");

  for (let i = 0; i < report.contradictions.length; i++) {
    const c = report.contradictions[i];
    const files = c.fileA === c.fileB ? c.fileA : `${c.fileA} <-> ${c.fileB}`;
    lines.push(`  ${i + 1}. [${files}] ${c.description}`);
  }

  lines.push("");
  lines.push("Review these files and resolve conflicting directives.");

  return lines.join("\n");
}

export function formatIdentityReport(report: IdentityReport): string {
  return [
    formatBudgetReport(report.budget),
    "",
    formatStalenessReport(report.staleness),
    "",
    formatConsistencyReport(report.consistency),
  ].join("\n");
}

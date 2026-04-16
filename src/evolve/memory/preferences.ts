/**
 * Preference pattern detection from decision traces.
 *
 * Analyzes decision traces to surface recurring patterns in agent behavior.
 * Patterns are visible to the user so they understand what their agent
 * has learned about their preferences.
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { readTraces } from "./trace.js";
import type {
  DecisionTrace,
  PreferenceOptions,
  PreferencePattern,
  PreferenceReport,
} from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const PREFERENCES_DIR = "workspace/memory";
const PREFERENCES_FILE = ".preferences.json";

/** Minimum number of traces with the same category to form a pattern. */
const MIN_SUPPORT_COUNT = 3;

/** Minimum confidence for a pattern to be reported. */
const MIN_CONFIDENCE = 0.6;

// ── Pattern Detection ────────────────────────────────────────────────────────

/**
 * Categorize a decision trace into a preference category.
 *
 * Uses keyword matching on the decision and action fields.
 */
function categorize(trace: DecisionTrace): string {
  const text = `${trace.decision} ${trace.action}`.toLowerCase();

  if (text.includes("email") || text.includes("message") || text.includes("reply")) {
    return "communication";
  }
  if (text.includes("schedule") || text.includes("calendar") || text.includes("meeting")) {
    return "scheduling";
  }
  if (text.includes("priority") || text.includes("urgent") || text.includes("important")) {
    return "prioritization";
  }
  if (text.includes("approve") || text.includes("reject") || text.includes("permission")) {
    return "approval";
  }
  if (text.includes("research") || text.includes("search") || text.includes("look up")) {
    return "research";
  }
  if (text.includes("alert") || text.includes("notify") || text.includes("remind")) {
    return "notifications";
  }
  return "general";
}

/**
 * Extract preference patterns from decision traces.
 *
 * Groups traces by category and outcome, identifies recurring patterns
 * where the agent consistently makes the same type of decision with
 * positive outcomes.
 */
function detectPatterns(traces: readonly DecisionTrace[]): PreferencePattern[] {
  if (traces.length < MIN_SUPPORT_COUNT) return [];

  // Group by category
  const byCategory = new Map<string, DecisionTrace[]>();
  for (const trace of traces) {
    const cat = categorize(trace);
    const group = byCategory.get(cat) ?? [];
    group.push(trace);
    byCategory.set(cat, group);
  }

  const patterns: PreferencePattern[] = [];

  for (const [category, group] of byCategory) {
    if (group.length < MIN_SUPPORT_COUNT) continue;

    // Calculate confidence from outcomes
    const successful = group.filter(
      (t) => t.outcome === "success" || t.feedback === "approved",
    ).length;
    const rejected = group.filter((t) => t.feedback === "rejected").length;
    const total = group.length;

    // Confidence = (successful - rejected) / total, clamped to [0, 1]
    const confidence = Math.max(0, Math.min(1, (successful - rejected) / total));

    if (confidence < MIN_CONFIDENCE) continue;

    // Build a description from the most common decision type
    const decisionCounts = new Map<string, number>();
    for (const t of group) {
      const key = t.decision.slice(0, 80);
      decisionCounts.set(key, (decisionCounts.get(key) ?? 0) + 1);
    }
    const topDecision = [...decisionCounts.entries()].sort(
      (a, b) => b[1] - a[1],
    )[0][0];

    const timestamps = group.map((t) => t.timestamp).sort();

    patterns.push({
      id: randomUUID(),
      description: `Agent consistently handles ${category} tasks: "${topDecision}"`,
      category,
      supportCount: group.length,
      confidence: Math.round(confidence * 100) / 100,
      detectedAt: timestamps[0],
      lastSeenAt: timestamps[timestamps.length - 1],
      exampleTraceIds: group.slice(0, 3).map((t) => t.id),
    });
  }

  return patterns.sort((a, b) => b.confidence - a.confidence);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Analyze decision traces and generate a preference report.
 *
 * This is the user-facing view of what their agent has learned.
 */
export async function analyzePreferences(
  options: PreferenceOptions,
): Promise<PreferenceReport> {
  const traces = await readTraces(options.deployDir);
  const patterns = detectPatterns(traces);

  const report: PreferenceReport = {
    patterns,
    totalDecisions: traces.length,
    trackedSince: traces.length > 0 ? traces[0].timestamp : new Date().toISOString(),
    generatedAt: new Date().toISOString(),
  };

  // Persist the report for reference
  const dir = join(options.deployDir, PREFERENCES_DIR);
  const path = join(dir, PREFERENCES_FILE);
  await writeFile(path, JSON.stringify(report, null, 2));

  return report;
}

/**
 * Load the last saved preference report (if any).
 */
export async function loadPreferences(
  deployDir: string,
): Promise<PreferenceReport | null> {
  const path = join(deployDir, PREFERENCES_DIR, PREFERENCES_FILE);
  if (!existsSync(path)) return null;

  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as PreferenceReport;
  } catch {
    return null;
  }
}

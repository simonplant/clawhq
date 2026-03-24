/**
 * Decision trace logging.
 *
 * Records agent decisions in an append-only JSONL file so users can
 * answer "why did you do that?" and the system can learn preferences.
 */

import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";

import { DIR_MODE_SECRET } from "../../config/defaults.js";

import type { DecisionTrace } from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const TRACE_DIR = "ops/audit";
const TRACE_FILE = "decisions.jsonl";

// ── Public API ───────────────────────────────────────────────────────────────

/** Path to the decision trace log. */
function tracePath(deployDir: string): string {
  return join(deployDir, TRACE_DIR, TRACE_FILE);
}

/**
 * Log a decision trace entry.
 *
 * Appends to an append-only JSONL file alongside other audit logs.
 */
export async function logDecision(
  deployDir: string,
  decision: Omit<DecisionTrace, "id" | "timestamp">,
): Promise<DecisionTrace> {
  const dir = join(deployDir, TRACE_DIR);
  mkdirSync(dir, { recursive: true, mode: DIR_MODE_SECRET });
  chmodSync(dir, DIR_MODE_SECRET);

  const entry: DecisionTrace = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    ...decision,
  };

  await appendFile(tracePath(deployDir), JSON.stringify(entry) + "\n");

  return entry;
}

/**
 * Read all decision trace entries.
 *
 * Returns entries in chronological order (oldest first).
 */
export async function readTraces(
  deployDir: string,
): Promise<DecisionTrace[]> {
  const path = tracePath(deployDir);
  if (!existsSync(path)) return [];

  try {
    const raw = await readFile(path, "utf-8");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as DecisionTrace);
  } catch (err) {
    console.warn("[evolve] Failed to read decision traces:", err);
    return [];
  }
}

/**
 * Record user feedback on a decision.
 *
 * Appends a feedback entry linked to the original trace ID.
 */
export async function recordFeedback(
  deployDir: string,
  traceId: string,
  feedback: "approved" | "rejected" | "corrected",
): Promise<boolean> {
  const traces = await readTraces(deployDir);
  const original = traces.find((t) => t.id === traceId);
  if (!original) return false;

  // Log a new trace referencing the feedback
  await logDecision(deployDir, {
    decision: original.decision,
    reasoning: original.reasoning,
    action: original.action,
    outcome: original.outcome,
    feedback,
  });

  return true;
}

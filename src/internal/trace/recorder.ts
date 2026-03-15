/**
 * Decision recorder — persists decision entries to the trace log.
 *
 * Every agent action should call `recordDecision` with the factors
 * (rules, preferences, context) that drove the decision. Entries are
 * stored as JSON in the ClawHQ data directory.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  DecisionEntry,
  DecisionFactor,
  DecisionStore,
  TraceContext,
} from "./types.js";

const STORE_FILE = "decision-trace.json";

function storePath(ctx: TraceContext): string {
  return join(ctx.clawhqDir, "trace", STORE_FILE);
}

async function ensureDir(ctx: TraceContext): Promise<void> {
  await mkdir(join(ctx.clawhqDir, "trace"), { recursive: true });
}

/** Load the decision store from disk. Returns empty store if not found. */
export async function loadDecisions(ctx: TraceContext): Promise<DecisionStore> {
  try {
    const content = await readFile(storePath(ctx), "utf-8");
    return JSON.parse(content) as DecisionStore;
  } catch {
    return { entries: [] };
  }
}

/** Save the decision store to disk. */
export async function saveDecisions(
  ctx: TraceContext,
  store: DecisionStore,
): Promise<void> {
  await ensureDir(ctx);
  await writeFile(
    storePath(ctx),
    JSON.stringify(store, null, 2) + "\n",
    "utf-8",
  );
}

/**
 * Record a new decision entry in the trace log.
 *
 * Returns the created entry with its generated ID and timestamp.
 */
export async function recordDecision(
  ctx: TraceContext,
  params: {
    actionType: string;
    summary: string;
    factors: DecisionFactor[];
    outcome: string;
    parentId?: string;
  },
): Promise<DecisionEntry> {
  const now = new Date();
  const entry: DecisionEntry = {
    id: `dec-${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: now.toISOString(),
    actionType: params.actionType,
    summary: params.summary,
    factors: params.factors,
    outcome: params.outcome,
    parentId: params.parentId,
  };

  const store = await loadDecisions(ctx);
  store.entries.push(entry);
  await saveDecisions(ctx, store);

  return entry;
}

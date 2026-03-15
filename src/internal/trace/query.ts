/**
 * Trace query — look up decisions by ID, action type, or time range,
 * and reconstruct the full decision chain for multi-step actions.
 */

import { loadDecisions } from "./recorder.js";
import type {
  DecisionEntry,
  DecisionStore,
  TraceContext,
  TraceQuery,
  TraceResult,
} from "./types.js";
import { TraceError } from "./types.js";

/**
 * Query the decision trace with optional filters.
 *
 * When querying by ID, the `chain` field in the result contains the
 * full parent chain from root to the requested entry.
 */
export async function queryTrace(
  ctx: TraceContext,
  query: TraceQuery,
): Promise<TraceResult> {
  const store = await loadDecisions(ctx);

  // Query by specific ID
  if (query.id) {
    return queryById(store, query.id);
  }

  // Filter by criteria
  const entries = filterEntries(store, query);

  return { entries, chain: [] };
}

/**
 * Look up a single decision and reconstruct its full parent chain.
 */
function queryById(store: DecisionStore, id: string): TraceResult {
  const entry = store.entries.find((e) => e.id === id);
  if (!entry) {
    throw new TraceError(`Decision not found: ${id}`, "NOT_FOUND");
  }

  const chain = buildChain(store, entry);

  return { entries: [entry], chain };
}

/**
 * Walk up the parent chain to build the full decision path.
 * Returns entries ordered root → leaf.
 */
function buildChain(store: DecisionStore, entry: DecisionEntry): DecisionEntry[] {
  const chain: DecisionEntry[] = [entry];
  let current = entry;

  while (current.parentId) {
    const parent = store.entries.find((e) => e.id === current.parentId);
    if (!parent) break;
    chain.unshift(parent);
    current = parent;
  }

  return chain;
}

/**
 * Filter entries by action type and/or time range.
 */
function filterEntries(store: DecisionStore, query: TraceQuery): DecisionEntry[] {
  let entries = store.entries;

  if (query.actionType) {
    entries = entries.filter((e) => e.actionType === query.actionType);
  }

  if (query.since) {
    const since = query.since;
    entries = entries.filter((e) => e.timestamp >= since);
  }

  if (query.before) {
    const before = query.before;
    entries = entries.filter((e) => e.timestamp < before);
  }

  if (query.limit && query.limit > 0) {
    entries = entries.slice(-query.limit);
  }

  return entries;
}

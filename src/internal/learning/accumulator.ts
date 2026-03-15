/**
 * Signal accumulator — tracks preference signals per category
 * and determines dominant signal types.
 *
 * Signals are persisted as a JSON file in the ClawHQ data directory.
 * One-time signals are stored for audit but excluded from accumulation.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  CategoryAccumulation,
  LearningContext,
  PreferenceSignal,
  SignalStore,
  SignalType,
} from "./types.js";

const STORE_FILE = "preference-signals.json";

function storePath(ctx: LearningContext): string {
  return join(ctx.clawhqDir, "learning", STORE_FILE);
}

async function ensureDir(ctx: LearningContext): Promise<void> {
  await mkdir(join(ctx.clawhqDir, "learning"), { recursive: true });
}

/** Load the signal store from disk. Returns empty store if not found. */
export async function loadSignals(ctx: LearningContext): Promise<SignalStore> {
  try {
    const content = await readFile(storePath(ctx), "utf-8");
    return JSON.parse(content) as SignalStore;
  } catch {
    return { signals: [] };
  }
}

/** Save the signal store to disk. */
export async function saveSignals(
  ctx: LearningContext,
  store: SignalStore,
): Promise<void> {
  await ensureDir(ctx);
  await writeFile(
    storePath(ctx),
    JSON.stringify(store, null, 2) + "\n",
    "utf-8",
  );
}

/** Record a new signal in the store. */
export async function recordSignal(
  ctx: LearningContext,
  signal: PreferenceSignal,
): Promise<SignalStore> {
  const store = await loadSignals(ctx);
  store.signals.push(signal);
  await saveSignals(ctx, store);
  return store;
}

/**
 * Get accumulated signals grouped by category.
 * One-time signals are excluded from accumulation.
 * Boundary signals are tracked separately and never overridden by preferences.
 */
export function accumulateByCategory(
  store: SignalStore,
): CategoryAccumulation[] {
  // Group non-one-time signals by category
  const groups = new Map<string, PreferenceSignal[]>();

  for (const signal of store.signals) {
    if (signal.signalType === "one-time") continue;

    const key = `${signal.category}::${signal.appliedToIdentity}`;
    const group = groups.get(key);
    if (group) {
      group.push(signal);
    } else {
      groups.set(key, [signal]);
    }
  }

  const accumulations: CategoryAccumulation[] = [];

  for (const [, signals] of groups) {
    const dominant = determineDominantType(signals);
    accumulations.push({
      category: signals[0].category,
      appliedToIdentity: signals[0].appliedToIdentity,
      signals,
      dominantType: dominant,
    });
  }

  return accumulations;
}

/**
 * Determine the dominant signal type in a group.
 * Boundary signals always dominate — they can never be overridden by preferences.
 */
export function determineDominantType(signals: PreferenceSignal[]): SignalType {
  const hasBoundary = signals.some((s) => s.signalType === "boundary");
  if (hasBoundary) return "boundary";
  return "preference";
}

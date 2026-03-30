/**
 * Construct state persistence — load and save construct state across runs.
 *
 * State is stored at `~/.clawhq/ops/construct/state.json`.
 * This ensures assessed gaps, proposals, and artifacts survive
 * between daily construct runs.
 */

import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { DIR_MODE_SECRET, FILE_MODE_SECRET } from "../../../config/defaults.js";
import type {
  ConstructArtifact,
  ConstructCycle,
  ConstructGap,
  ConstructProposal,
  ConstructState,
} from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const STATE_DIR = "ops/construct";
const STATE_FILENAME = "state.json";

/** Maximum number of cycle records retained in state. */
const MAX_CYCLE_HISTORY = 30;

// ── Paths ───────────────────────────────────────────────────────────────────

export function stateDir(deployDir: string): string {
  return join(deployDir, STATE_DIR);
}

export function statePath(deployDir: string): string {
  return join(deployDir, STATE_DIR, STATE_FILENAME);
}

// ── Empty State ─────────────────────────────────────────────────────────────

export function emptyState(): ConstructState {
  return {
    version: 1,
    gaps: {},
    proposals: {},
    artifacts: {},
    cycles: [],
    lastUpdatedAt: new Date().toISOString(),
  };
}

// ── Load / Save ─────────────────────────────────────────────────────────────

/**
 * Load construct state from disk.
 * Returns empty state if file does not exist or is unreadable.
 */
export async function loadConstructState(deployDir: string): Promise<ConstructState> {
  const path = statePath(deployDir);
  if (!existsSync(path)) {
    return emptyState();
  }
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.version !== 1) {
      throw new Error(`Unsupported construct state version: ${String(parsed.version)}`);
    }
    return parsed as unknown as ConstructState;
  } catch {
    return emptyState();
  }
}

/**
 * Save construct state to disk.
 * Creates the directory if it does not exist.
 */
export async function saveConstructState(
  deployDir: string,
  state: ConstructState,
): Promise<void> {
  const dir = stateDir(deployDir);
  mkdirSync(dir, { recursive: true, mode: DIR_MODE_SECRET });
  chmodSync(dir, DIR_MODE_SECRET);
  const updated: ConstructState = {
    ...state,
    lastUpdatedAt: new Date().toISOString(),
  };
  await writeFile(statePath(deployDir), JSON.stringify(updated, null, 2), {
    mode: FILE_MODE_SECRET,
  });
}

// ── State Mutations ─────────────────────────────────────────────────────────

/** Record assessed gaps in state. */
export function recordGaps(
  state: ConstructState,
  gaps: readonly ConstructGap[],
): ConstructState {
  const updated = { ...state.gaps };
  for (const gap of gaps) {
    updated[gap.id] = gap;
  }
  return { ...state, gaps: updated };
}

/** Record a proposal in state. */
export function recordProposal(
  state: ConstructState,
  proposal: ConstructProposal,
): ConstructState {
  return {
    ...state,
    proposals: { ...state.proposals, [proposal.skillName]: proposal },
  };
}

/** Record a built artifact in state. */
export function recordArtifact(
  state: ConstructState,
  artifact: ConstructArtifact,
): ConstructState {
  return {
    ...state,
    artifacts: { ...state.artifacts, [artifact.skillName]: artifact },
  };
}

/** Append a cycle to history (pruning oldest if over limit). */
export function recordCycle(
  state: ConstructState,
  cycle: ConstructCycle,
): ConstructState {
  const cycles = [...state.cycles, cycle];
  const pruned = cycles.length > MAX_CYCLE_HISTORY
    ? cycles.slice(cycles.length - MAX_CYCLE_HISTORY)
    : cycles;
  return { ...state, cycles: pruned };
}

/** Get gap IDs that have already been assessed. */
export function assessedGapIds(state: ConstructState): ReadonlySet<string> {
  return new Set(Object.keys(state.gaps));
}

/** Get skill names that have already been proposed. */
export function proposedSkillNames(state: ConstructState): ReadonlySet<string> {
  return new Set(Object.keys(state.proposals));
}

/** Get skill names that have been built (artifact exists). */
export function builtSkillNames(state: ConstructState): ReadonlySet<string> {
  return new Set(Object.keys(state.artifacts));
}

/**
 * Applied-migrations ledger.
 *
 * Persistent record of which migrations have actually run against this
 * deployment. Lives at `<deployDir>/ops/migrations/applied.json`.
 *
 * Why this exists: the prior registry-only approach decided which
 * migrations to run by comparing the old and new OpenClaw versions. If
 * `clawhq update` crashed halfway through a multi-migration plan, the
 * next run would pick the plan up from the same version range and
 * replay every migration — including the ones that already succeeded.
 * Most migrations are idempotent by construction, but any that check
 * "did this key exist before mutation" (and many do) would see
 * post-migration state on a replay and either no-op silently or corrupt
 * further. This ledger closes the gap:
 *
 *   - Before running each migration, record `status: "in_progress"` with
 *     the source/target versions it was asked to span.
 *   - After the migration's `up()` returns success, promote to `status:
 *     "complete"`.
 *   - The plan builder consults the ledger and skips migrations whose
 *     id is already `complete`. In-progress entries are re-executed
 *     (migrations are contractually idempotent; the test helper
 *     `assertMigrationIdempotent` enforces this on the way in).
 *
 * The ledger keys on migration `id` because ids are stable across
 * releases; version ranges are not (a patch release can renumber a
 * migration's toVersion).
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ── Types ───────────────────────────────────────────────────────────────────

export type MigrationLedgerStatus = "in_progress" | "complete";

export interface MigrationLedgerEntry {
  readonly status: MigrationLedgerStatus;
  /** ISO timestamp of the most recent status transition. */
  readonly at: string;
  /** Version the deployment was at when this migration was invoked. */
  readonly fromVersion: string;
  /** Version the migration is targeted at. */
  readonly toVersion: string;
  /** Error text — only populated for interrupted runs. */
  readonly error?: string;
}

export interface MigrationLedger {
  readonly version: 1;
  readonly applied: Readonly<Record<string, MigrationLedgerEntry>>;
}

const EMPTY_LEDGER: MigrationLedger = { version: 1, applied: {} };

// ── Paths ───────────────────────────────────────────────────────────────────

export function ledgerPath(deployDir: string): string {
  return join(deployDir, "ops", "migrations", "applied.json");
}

// ── I/O ─────────────────────────────────────────────────────────────────────

export async function loadLedger(deployDir: string): Promise<MigrationLedger> {
  const path = ledgerPath(deployDir);
  if (!existsSync(path)) return EMPTY_LEDGER;
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    throw new Error(
      `failed to read migration ledger at ${path}: ` +
      (err instanceof Error ? err.message : String(err)),
      { cause: err },
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // Corruption here is not safe to silently paper over — silently
    // returning an empty ledger would mean "re-execute every migration
    // that's ever applied", which for an in-progress Clawdius is the same
    // as the original bug this module is fixing.
    throw new Error(
      `migration ledger at ${path} is corrupt: ` +
      (err instanceof Error ? err.message : String(err)) +
      `. Inspect the file manually; do not run \`clawhq update\` until this is resolved.`,
      { cause: err },
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`migration ledger at ${path} is not an object`);
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1) {
    throw new Error(
      `migration ledger at ${path} has unsupported version ${String(obj.version)} (expected 1)`,
    );
  }
  if (!obj.applied || typeof obj.applied !== "object") {
    throw new Error(`migration ledger at ${path} is missing the \`applied\` object`);
  }
  return obj as unknown as MigrationLedger;
}

async function saveLedger(deployDir: string, ledger: MigrationLedger): Promise<void> {
  const path = ledgerPath(deployDir);
  await mkdir(join(deployDir, "ops", "migrations"), { recursive: true });
  await writeFile(path, JSON.stringify(ledger, null, 2) + "\n", "utf-8");
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Record that a migration is about to run.
 *
 * Writes `status: "in_progress"` with the provided version range. Returns
 * the updated ledger — callers should continue using the returned value
 * rather than the input.
 */
export async function markInProgress(
  deployDir: string,
  migrationId: string,
  fromVersion: string,
  toVersion: string,
): Promise<MigrationLedger> {
  const current = await loadLedger(deployDir);
  const entry: MigrationLedgerEntry = {
    status: "in_progress",
    at: new Date().toISOString(),
    fromVersion,
    toVersion,
  };
  const next: MigrationLedger = {
    version: 1,
    applied: { ...current.applied, [migrationId]: entry },
  };
  await saveLedger(deployDir, next);
  return next;
}

/**
 * Promote an in-progress entry to `complete` after its `up()` returned
 * success. No-op if the entry was already `complete` (idempotent re-runs).
 */
export async function markComplete(
  deployDir: string,
  migrationId: string,
): Promise<MigrationLedger> {
  const current = await loadLedger(deployDir);
  const existing = current.applied[migrationId];
  const entry: MigrationLedgerEntry = {
    status: "complete",
    at: new Date().toISOString(),
    fromVersion: existing?.fromVersion ?? "",
    toVersion: existing?.toVersion ?? "",
  };
  const next: MigrationLedger = {
    version: 1,
    applied: { ...current.applied, [migrationId]: entry },
  };
  await saveLedger(deployDir, next);
  return next;
}

/**
 * Record that an in-progress migration failed. The entry stays in the
 * ledger as `in_progress` with an `error` field so the next update run
 * knows a retry is in order.
 */
export async function markFailed(
  deployDir: string,
  migrationId: string,
  error: string,
): Promise<MigrationLedger> {
  const current = await loadLedger(deployDir);
  const existing = current.applied[migrationId];
  const entry: MigrationLedgerEntry = {
    status: "in_progress",
    at: new Date().toISOString(),
    fromVersion: existing?.fromVersion ?? "",
    toVersion: existing?.toVersion ?? "",
    error,
  };
  const next: MigrationLedger = {
    version: 1,
    applied: { ...current.applied, [migrationId]: entry },
  };
  await saveLedger(deployDir, next);
  return next;
}

/**
 * Return true if the migration has already completed successfully against
 * this deployment. Used by the plan builder to skip replays.
 */
export function isComplete(ledger: MigrationLedger, migrationId: string): boolean {
  return ledger.applied[migrationId]?.status === "complete";
}

/**
 * List migration ids that are recorded as `in_progress` — likely interrupted
 * runs that need to retry.
 */
export function listInProgress(ledger: MigrationLedger): string[] {
  return Object.entries(ledger.applied)
    .filter(([, entry]) => entry.status === "in_progress")
    .map(([id]) => id);
}

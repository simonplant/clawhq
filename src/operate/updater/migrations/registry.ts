/**
 * Migration registry — discovers, orders, and executes versioned migrations.
 *
 * Migrations are statically imported (not filesystem-scanned) to ensure
 * bundler compatibility. The registry starts empty — migrations are added
 * as OpenClaw releases introduce breaking config changes.
 *
 * Key function: `buildMigrationPlan(from, to)` selects migrations where
 * `from < migration.toVersion <= to`, ordered by target version.
 */

import { compareVersions } from "../calver.js";
import { isComplete, loadLedger, markComplete, markFailed, markInProgress } from "../ledger.js";

import type {
  Migration,
  MigrationContext,
  MigrationPlan,
  MigrationResult,
  MigrationStepResult,
} from "./types.js";

// ── Migration Imports ─────────────────────────────────────────────────────
// Add static imports here as migrations are created:
// import { migration as m_2026_4_10 } from "./2026.4.10-rename-exec-host.js";

// ── Registry ──────────────────────────────────────────────────────────────

/**
 * All registered migrations, ordered by target version.
 *
 * To add a migration:
 * 1. Create a file in this directory (e.g. `2026.4.10-rename-exec-host.ts`)
 * 2. Import it above
 * 3. Add it to this array
 */
const ALL_MIGRATIONS: readonly Migration[] = [
  // Migrations will be added here as OpenClaw releases break config
];

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Build a migration plan between two versions.
 *
 * Selects migrations where `fromVersion < migration.toVersion <= toVersion`,
 * ordered from oldest to newest target version.
 */
export function buildMigrationPlan(
  fromVersion: string,
  toVersion: string,
): MigrationPlan {
  const from = stripPrefix(fromVersion);
  const to = stripPrefix(toVersion);

  const applicable = ALL_MIGRATIONS.filter((m) => {
    const mTo = stripPrefix(m.toVersion);
    const mFrom = stripPrefix(m.fromVersion);
    // Migration applies when: fromVersion < m.toVersion AND m.fromVersion < toVersion
    // This selects migrations whose target falls within the upgrade range
    return compareVersions(from, mTo) < 0
      && compareVersions(mFrom, to) < 0;
  });

  // Sort by target version (oldest first)
  applicable.sort((a, b) => compareVersions(a.toVersion, b.toVersion));

  const allChanges = applicable.flatMap((m) => m.changes);
  const breakingTypes = new Set(["schema-changed", "compose-changed"]);

  return {
    migrations: applicable,
    fromVersion,
    toVersion,
    changes: allChanges,
    hasBreakingChanges: allChanges.some((c) => breakingTypes.has(c.type)),
  };
}

/**
 * Execute a migration plan forward (up).
 *
 * Runs each migration's `up()` in order. Consults the applied-migrations
 * ledger and skips migrations that have already completed — re-running
 * a plan after a mid-execution crash only re-executes the migrations
 * that were not yet complete. Stops on first failure, and leaves the
 * failing migration's ledger entry in `in_progress` state so the next
 * run picks up where we left off.
 */
export async function executeMigrationPlan(
  plan: MigrationPlan,
  context: MigrationContext,
): Promise<MigrationResult> {
  const applied: MigrationStepResult[] = [];

  // Load the ledger once at the start — entries mutate across iterations
  // but each mark* call re-reads from disk to stay consistent with any
  // concurrent writer (e.g. a parallel doctor pass).
  let ledger = await loadLedger(context.deployDir);

  for (const migration of plan.migrations) {
    if (context.signal?.aborted) {
      return {
        success: false,
        applied,
        error: "Migration aborted",
      };
    }

    if (isComplete(ledger, migration.id)) {
      // Previously completed — skip. Record a synthetic "success" entry
      // so caller-side reporting still shows the full plan span.
      applied.push({
        success: true,
        migrationId: migration.id,
        filesModified: [],
      });
      continue;
    }

    ledger = await markInProgress(
      context.deployDir,
      migration.id,
      migration.fromVersion,
      migration.toVersion,
    );

    try {
      const result = await migration.up(context);
      applied.push(result);

      if (!result.success) {
        await markFailed(
          context.deployDir,
          migration.id,
          result.error ?? "migration returned success: false",
        );
        return {
          success: false,
          applied,
          error: `Migration ${migration.id} failed: ${result.error}`,
        };
      }
      ledger = await markComplete(context.deployDir, migration.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      applied.push({
        success: false,
        migrationId: migration.id,
        error: message,
      });
      await markFailed(context.deployDir, migration.id, message);
      return {
        success: false,
        applied,
        error: `Migration ${migration.id} threw: ${message}`,
      };
    }
  }

  return { success: true, applied };
}

/**
 * Roll back applied migrations in reverse order.
 *
 * Calls `down()` for each successfully applied migration, newest first.
 * Best-effort — continues even if individual rollbacks fail.
 */
export async function rollbackMigrations(
  applied: readonly MigrationStepResult[],
  plan: MigrationPlan,
  context: MigrationContext,
): Promise<MigrationResult> {
  const results: MigrationStepResult[] = [];
  let allSuccess = true;

  // Find successfully applied migrations and roll them back in reverse
  const successIds = new Set(
    applied.filter((r) => r.success).map((r) => r.migrationId),
  );

  const toRollback = [...plan.migrations]
    .filter((m) => successIds.has(m.id))
    .reverse();

  for (const migration of toRollback) {
    try {
      const result = await migration.down(context);
      results.push(result);
      if (!result.success) allSuccess = false;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        success: false,
        migrationId: migration.id,
        error: `Rollback threw: ${message}`,
      });
      allSuccess = false;
    }
  }

  return {
    success: allSuccess,
    applied: results,
    error: allSuccess ? undefined : "Some migration rollbacks failed",
  };
}

/**
 * Check if a migration plan contains only config-level changes
 * (no image rebuild needed).
 */
export function isConfigOnlyPlan(plan: MigrationPlan): boolean {
  const rebuildTypes = new Set(["compose-changed", "schema-changed"]);
  return plan.changes.every((c) => !rebuildTypes.has(c.type));
}

// ── Helpers ────────────────────────────────────────────────────────────────

function stripPrefix(version: string): string {
  return version.startsWith("v") ? version.slice(1) : version;
}

// ── Testing Helpers ───────────────────────────────────────────────────────

/**
 * Build a migration plan from a custom set of migrations.
 * Used in tests to avoid polluting the global registry.
 */
export function buildMigrationPlanFrom(
  fromVersion: string,
  toVersion: string,
  migrations: readonly Migration[],
): MigrationPlan {
  const from = stripPrefix(fromVersion);
  const to = stripPrefix(toVersion);

  const applicable = migrations.filter((m) => {
    const mTo = stripPrefix(m.toVersion);
    const mFrom = stripPrefix(m.fromVersion);
    return compareVersions(from, mTo) < 0
      && compareVersions(mFrom, to) < 0;
  });

  applicable.sort((a, b) => compareVersions(a.toVersion, b.toVersion));

  const allChanges = applicable.flatMap((m) => m.changes);
  const breakingTypes = new Set(["schema-changed", "compose-changed"]);

  return {
    migrations: applicable,
    fromVersion,
    toVersion,
    changes: allChanges,
    hasBreakingChanges: allChanges.some((c) => breakingTypes.has(c.type)),
  };
}

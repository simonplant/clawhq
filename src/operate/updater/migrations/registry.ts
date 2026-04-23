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
 * Runs each migration's `up()` in order. Stops on first failure.
 * Returns results for all attempted migrations.
 *
 * Note on crash recovery: migrations must be idempotent so a re-run after
 * a mid-plan crash is safe. This is a contract on migration authors, not
 * enforced by the registry. When the first real migration ships, revisit
 * whether a persistent "applied" ledger is warranted — don't build it
 * speculatively.
 */
export async function executeMigrationPlan(
  plan: MigrationPlan,
  context: MigrationContext,
): Promise<MigrationResult> {
  const applied: MigrationStepResult[] = [];

  for (const migration of plan.migrations) {
    if (context.signal?.aborted) {
      return {
        success: false,
        applied,
        error: "Migration aborted",
      };
    }

    try {
      const result = await migration.up(context);
      applied.push(result);

      if (!result.success) {
        return {
          success: false,
          applied,
          error: `Migration ${migration.id} failed: ${result.error}`,
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      applied.push({
        success: false,
        migrationId: migration.id,
        error: message,
      });
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

/**
 * Types for versioned config migrations between OpenClaw releases.
 *
 * Each migration transforms config/compose/workspace files from one
 * OpenClaw version to the next. Migrations are reversible — every `up()`
 * has a corresponding `down()`.
 */

// ── Migration Definition ──────────────────────────────────────────────────

/** Nature of a config change in a migration. */
export type MigrationChangeType =
  | "config-key-renamed"
  | "config-key-removed"
  | "config-key-added"
  | "default-changed"
  | "env-var-renamed"
  | "env-var-removed"
  | "env-var-added"
  | "schema-changed"
  | "compose-changed";

/** A single config change within a migration. */
export interface MigrationChange {
  readonly type: MigrationChangeType;
  /** Dot-path or env var name affected. */
  readonly path: string;
  /** Human-readable description of what changed. */
  readonly description: string;
}

/** Result of executing a single migration step (up or down). */
export interface MigrationStepResult {
  readonly success: boolean;
  readonly migrationId: string;
  readonly error?: string;
  /** Files that were modified. */
  readonly filesModified?: readonly string[];
}

/**
 * Context provided to migration up/down functions.
 *
 * Provides safe read/write access to the deployment directory
 * without exposing raw filesystem operations.
 */
export interface MigrationContext {
  readonly deployDir: string;
  readonly signal?: AbortSignal;
  /** Current OpenClaw runtime config (parsed openclaw.json). */
  readonly config: Record<string, unknown>;
  /** Current docker-compose.yml content. */
  readonly compose: string;
  /** Current .env content (if present). */
  readonly env: string;
  /** Write updated config back to openclaw.json. */
  writeConfig(config: Record<string, unknown>): Promise<void>;
  /** Write updated compose back to docker-compose.yml. */
  writeCompose(compose: string): Promise<void>;
  /** Write updated env back to .env. */
  writeEnv(env: string): Promise<void>;
  /** Read an arbitrary file from the engine directory. Returns null if missing. */
  readEngineFile(relativePath: string): Promise<string | null>;
  /** Write an arbitrary file to the engine directory. */
  writeEngineFile(relativePath: string, content: string): Promise<void>;
}

/**
 * A versioned migration between OpenClaw releases.
 *
 * Each migration applies to a specific version transition. The registry
 * selects applicable migrations based on the (from, to] version range.
 */
export interface Migration {
  /** Unique identifier, e.g. "2026.4.10-rename-exec-host". */
  readonly id: string;
  /** Human-readable description. */
  readonly description: string;
  /** Version this migration applies from (exclusive lower bound). */
  readonly fromVersion: string;
  /** Version this migration targets (inclusive upper bound). */
  readonly toVersion: string;
  /** What changed — used for display and classification. */
  readonly changes: readonly MigrationChange[];
  /** Apply the migration forward. Never throws — returns structured result. */
  up(ctx: MigrationContext): Promise<MigrationStepResult>;
  /** Reverse the migration. Never throws — returns structured result. */
  down(ctx: MigrationContext): Promise<MigrationStepResult>;
}

// ── Migration Plan ────────────────────────────────────────────────────────

/** An ordered set of migrations to execute between two versions. */
export interface MigrationPlan {
  /** Migrations to run, ordered from oldest to newest. */
  readonly migrations: readonly Migration[];
  /** Source version (current deployment). */
  readonly fromVersion: string;
  /** Target version (update target). */
  readonly toVersion: string;
  /** Aggregated changes across all migrations. */
  readonly changes: readonly MigrationChange[];
  /** Whether any migration contains a breaking change type (schema-changed, compose-changed). */
  readonly hasBreakingChanges: boolean;
}

// ── Migration Result ──────────────────────────────────────────────────────

/** Result of executing a migration plan. */
export interface MigrationResult {
  readonly success: boolean;
  /** Results for each migration that was attempted. */
  readonly applied: readonly MigrationStepResult[];
  /** Error message if the plan failed. */
  readonly error?: string;
}

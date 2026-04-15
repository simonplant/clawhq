/**
 * Types for the update intelligence system.
 *
 * `clawhq update [--check]` updates the OpenClaw engine with:
 *   - Change intelligence (deployment-specific impact analysis)
 *   - Versioned config migrations (automatic, reversible)
 *   - Blue-green deploy (zero-downtime container swap)
 *   - Update channels (security/stable/latest/pinned)
 *
 * Two install modes:
 *   - "cache": docker pull latest image
 *   - "source": git pull + two-stage Docker build
 *
 * Pipeline: check → analyze → backup → pull/build → migrate → restart/blue-green → verify → (rollback on failure)
 */

import type { MigrationPlan } from "./migrations/types.js";

// ── Pipeline Steps ──────────────────────────────────────────────────────────

/** Steps in the update pipeline. */
export type UpdateStep =
  | "check"
  | "analyze"
  | "backup"
  | "pull"
  | "build"
  | "migrate"
  | "restart"
  | "canary-start"
  | "canary-verify"
  | "swap"
  | "verify"
  | "rollback";

/** Status of an update step. */
export type UpdateStepStatus = "running" | "done" | "failed" | "skipped";

/** Progress event for the update pipeline. */
export interface UpdateProgress {
  readonly step: UpdateStep;
  readonly status: UpdateStepStatus;
  readonly message: string;
}

/** Callback for step-by-step progress reporting. */
export type UpdateProgressCallback = (progress: UpdateProgress) => void;

// ── Update Channels ─────────────────────────────────────────────────────────

/** Update channel policy. */
export type UpdateChannel = "security" | "stable" | "latest" | "pinned";

// ── Check Result ────────────────────────────────────────────────────────────

/** Result of checking for available updates. */
export interface UpdateCheckResult {
  readonly available: boolean;
  readonly currentImage: string;
  readonly currentVersion?: string;
  readonly targetVersion?: string;
  readonly latestDigest?: string;
  /** Change intelligence report (when available). */
  readonly intelligence?: ChangeIntelligenceReport;
  readonly error?: string;
}

// ── Change Intelligence ─────────────────────────────────────────────────────

/** Classification of a release. */
export type ReleaseClassification = "security-patch" | "bugfix" | "feature" | "breaking";

/** Update recommendation. */
export interface UpdateRecommendation {
  readonly action: "update-now" | "update-soon" | "wait" | "hold";
  readonly reason: string;
  readonly risks: readonly string[];
}

/** Change intelligence report — deployment-specific update analysis. */
export interface ChangeIntelligenceReport {
  /** How the release is classified. */
  readonly classification: ReleaseClassification;
  /** Number of upstream commits between current and target. */
  readonly commitCount: number;
  /** Config areas impacted by the upstream changes. */
  readonly impactAreas: readonly string[];
  /** Whether upstream changes may break this deployment's config. */
  readonly hasBreakageRisk: boolean;
  /** Pending migrations between current and target version. */
  readonly migrationPlan: MigrationPlan | null;
  /** Update recommendation based on all intelligence. */
  readonly recommendation: UpdateRecommendation;
  /** Release notes (if available from GitHub). */
  readonly releaseNotes?: string;
}

// ── Update Result ───────────────────────────────────────────────────────────

/** Result of a full update operation. */
export interface UpdateResult {
  readonly success: boolean;
  /** Whether a rollback was performed. */
  readonly rolledBack?: boolean;
  /** Pre-update backup snapshot ID. */
  readonly backupId?: string;
  /** Number of config migrations applied. */
  readonly migrationsApplied?: number;
  /** Whether blue-green deploy was used. */
  readonly blueGreen?: boolean;
  readonly error?: string;
}

// ── Options ─────────────────────────────────────────────────────────────────

/** Options for checking/applying updates. */
export interface UpdateOptions {
  readonly deployDir: string;
  /** Only check, don't apply. */
  readonly checkOnly?: boolean;
  /** Passphrase for pre-update backup encryption. */
  readonly passphrase?: string;
  /** Gateway auth token for restart verification. */
  readonly gatewayToken?: string;
  /** Gateway port (default: GATEWAY_DEFAULT_PORT). */
  readonly gatewayPort?: number;
  /** Update channel override (reads from clawhq.yaml if not set). */
  readonly channel?: UpdateChannel;
  /** Use blue-green deploy (default: true). */
  readonly blueGreen?: boolean;
  /** Dry run — show migration plan without applying. */
  readonly dryRun?: boolean;
  /** Progress callback. */
  readonly onProgress?: UpdateProgressCallback;
  /** AbortSignal for cancellation. */
  readonly signal?: AbortSignal;
}

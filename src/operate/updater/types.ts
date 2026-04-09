/**
 * Types for safe upstream updates with automatic rollback.
 *
 * `clawhq update [--check]` updates the OpenClaw engine and restarts.
 * Two modes based on installMethod:
 *   - "cache": docker pull latest image
 *   - "source": git pull + clawhq build (rebuild from source)
 *
 * Pipeline: check → backup → pull/build → restart → verify → (rollback on failure)
 */

// ── Pipeline Steps ──────────────────────────────────────────────────────────

/** Steps in the update pipeline. */
export type UpdateStep =
  | "check"
  | "backup"
  | "pull"
  | "build"
  | "restart"
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

// ── Check Result ────────────────────────────────────────────────────────────

/** Result of checking for available updates. */
export interface UpdateCheckResult {
  readonly available: boolean;
  readonly currentImage: string;
  readonly latestDigest?: string;
  readonly error?: string;
}

// ── Update Result ───────────────────────────────────────────────────────────

/** Result of a full update operation. */
export interface UpdateResult {
  readonly success: boolean;
  /** Whether a rollback was performed. */
  readonly rolledBack?: boolean;
  /** Pre-update backup snapshot ID. */
  readonly backupId?: string;
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
  /** Progress callback. */
  readonly onProgress?: UpdateProgressCallback;
  /** AbortSignal for cancellation. */
  readonly signal?: AbortSignal;
}

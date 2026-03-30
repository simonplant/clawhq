/**
 * Types for operational automation scripts and systemd units.
 *
 * Generated during `clawhq init` and deployed via `clawhq ops install`.
 */

// ── Generated Script ───────────────────────────────────────────────────────

/** A generated operational script or unit file. */
export interface OpsScriptEntry {
  /** Filename (e.g. "clawhq-autoupdate.sh"). */
  readonly filename: string;
  /** File content. */
  readonly content: string;
  /** File permission mode (default: 0o755 for scripts, 0o644 for units). */
  readonly mode: number;
  /** Relative path within ops/automation/ subdirectory. */
  readonly relativePath: string;
}

// ── Install Options ────────────────────────────────────────────────────────

/** Options for deploying ops automation to systemd. */
export interface OpsInstallOptions {
  /** Path to the deployment directory (default: ~/.clawhq). */
  readonly deployDir: string;
  /** AbortSignal for cancellation. */
  readonly signal?: AbortSignal;
}

/** Result of an ops install operation. */
export interface OpsInstallResult {
  /** Whether all units were installed and enabled successfully. */
  readonly success: boolean;
  /** Services/timers that were installed. */
  readonly installed: readonly string[];
  /** Services/timers that were enabled. */
  readonly enabled: readonly string[];
  /** Error message if installation failed. */
  readonly error?: string;
}

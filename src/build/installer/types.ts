/**
 * Types for the platform installer.
 *
 * Covers prerequisite detection results, scaffold options, and the
 * overall install result reported back to the CLI.
 */

// ── Prerequisite Detection ──────────────────────────────────────────────────

/** Status of a single prerequisite check. */
export interface PrereqCheckResult {
  /** Prerequisite name (e.g. "docker", "node", "ollama"). */
  readonly name: string;
  /** Whether the prerequisite is satisfied. */
  readonly ok: boolean;
  /** Human-readable detail (version found, error message, etc.). */
  readonly detail: string;
}

/** Aggregate result of all prerequisite checks. */
export interface PrereqReport {
  /** True only if every prerequisite passed. */
  readonly passed: boolean;
  /** Individual check results. */
  readonly checks: readonly PrereqCheckResult[];
}

// ── Scaffold ────────────────────────────────────────────────────────────────

/** Directories created during scaffold. */
export interface ScaffoldResult {
  /** Absolute paths of directories that were created. */
  readonly created: readonly string[];
  /** Absolute path to the deploy directory root. */
  readonly deployDir: string;
}

// ── Install ─────────────────────────────────────────────────────────────────

/** Options for `install()`. */
export interface InstallOptions {
  /** Deployment directory. Default: ~/.clawhq */
  readonly deployDir: string;
  /** If true, install from source (zero-trust path). */
  readonly fromSource?: boolean;
}

/** Result of `install()`. */
export interface InstallResult {
  /** Whether the install succeeded. */
  readonly success: boolean;
  /** Prerequisite report. */
  readonly prereqs: PrereqReport;
  /** Scaffold result (only present if prereqs passed). */
  readonly scaffold?: ScaffoldResult;
  /** Absolute path to the written clawhq.yaml (only present on success). */
  readonly configPath?: string;
  /** Error message if install failed. */
  readonly error?: string;
}

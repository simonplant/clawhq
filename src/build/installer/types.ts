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

// ── Source Build ─────────────────────────────────────────────────────────────

/** Options for building the engine from source. */
export interface SourceBuildOptions {
  /** Deployment directory root (~/.clawhq). */
  readonly deployDir: string;
  /** OpenClaw repository URL to clone. */
  readonly repoUrl?: string;
  /** Git ref to check out (tag, branch, or commit). Default: latest tag. */
  readonly ref?: string;
  /** Progress callback for UX updates. */
  readonly onProgress?: (phase: string, detail: string) => void;
}

/** Result of a from-source engine build. */
export interface SourceBuildResult {
  /** Whether the build succeeded. */
  readonly success: boolean;
  /** Absolute path to cloned source directory. */
  readonly sourceDir: string;
  /** Docker image ID of the built engine artifact. */
  readonly imageId?: string;
  /** SHA-256 digest of the built image. */
  readonly imageDigest?: string;
  /** Error message if build failed. */
  readonly error?: string;
}

/** Result of artifact verification. */
export interface VerifyResult {
  /** Whether the built artifact matches the release artifact. */
  readonly match: boolean;
  /** SHA-256 digest of the locally built image. */
  readonly localDigest: string;
  /** SHA-256 digest of the release image (null if unavailable). */
  readonly releaseDigest: string | null;
  /** Human-readable detail. */
  readonly detail: string;
}

// ── Install ─────────────────────────────────────────────────────────────────

/** Options for `install()`. */
export interface InstallOptions {
  /** Deployment directory. Default: ~/.clawhq */
  readonly deployDir: string;
  /** If true, install from source (zero-trust path). */
  readonly fromSource?: boolean;
  /** OpenClaw repository URL (for --from-source). */
  readonly repoUrl?: string;
  /** Git ref to check out (for --from-source). */
  readonly ref?: string;
  /** Progress callback for UX updates. */
  readonly onProgress?: (phase: string, detail: string) => void;
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
  /** Source build result (only present for --from-source). */
  readonly sourceBuild?: SourceBuildResult;
  /** Verification result (only present for --from-source). */
  readonly verify?: VerifyResult;
  /** Error message if install failed. */
  readonly error?: string;
}

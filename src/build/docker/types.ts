/**
 * Types for Docker two-stage build and container hardening.
 *
 * Covers build configuration, security postures, build manifests,
 * and cache detection for the `clawhq build` command.
 */

// ── Security Posture ────────────────────────────────────────────────────────

/** Security posture level. */
export type BuildSecurityPosture = "minimal" | "hardened" | "under-attack";

/** Resource limits applied per security posture. */
export interface ResourceLimits {
  readonly cpus: number;
  readonly memoryMb: number;
  readonly pidsLimit: number;
}

/** Tmpfs mount configuration per posture. */
export interface TmpfsConfig {
  readonly sizeMb: number;
  readonly options: string;
}

/** Complete security posture configuration for container hardening. */
export interface PostureConfig {
  readonly posture: BuildSecurityPosture;
  readonly capDrop: readonly string[];
  readonly securityOpt: readonly string[];
  readonly readOnlyRootfs: boolean;
  readonly user: string;
  readonly iccDisabled: boolean;
  readonly resources: ResourceLimits;
  readonly tmpfs: TmpfsConfig;
  /** OCI runtime override (e.g. "runsc" for gVisor kernel isolation). */
  readonly runtime?: string;
  /** Auto-enable egress firewall for this posture level. */
  readonly autoFirewall: boolean;
  /** Mark identity files immutable (chattr +i) after deploy. */
  readonly immutableIdentity: boolean;
  /** Block ALL egress including DNS — full network isolation. */
  readonly airGap: boolean;
  /** Healthcheck interval (seconds). Shorter under attack for faster detection. */
  readonly healthcheckIntervalSecs: number;
}

// ── Workspace Manifest ─────────────────────────────────────────────────────

/**
 * Workspace integrity manifest — classifies workspace paths by mutability.
 *
 * When present, the compose generator replaces the single blanket workspace
 * volume mount with granular per-directory mounts:
 * - `persistent` dirs are mounted read-write (memory, state)
 * - `config` paths are mounted read-only (BOOTSTRAP.md, etc.)
 * - `immutable` paths are NOT mounted — they come from the image layer
 * - `ephemeral` paths use tmpfs (not yet implemented)
 */
export interface WorkspaceManifest {
  /** Directories that persist agent-written data (e.g. "memory", "state"). Mounted read-write. */
  readonly persistent: readonly string[];
  /** Files/dirs that the agent reads but must not modify (e.g. "BOOTSTRAP.md"). Mounted read-only. */
  readonly config: readonly string[];
  /** Files/dirs baked into the image layer that must NOT be volume-mounted (e.g. "tools", "identity"). */
  readonly immutable: readonly string[];
  /** Paths that use tmpfs — written at runtime, discarded on restart. */
  readonly ephemeral: readonly string[];
}

// ── Build Configuration ─────────────────────────────────────────────────────

/** Packages to install in Stage 1 (base image). */
export interface Stage1Config {
  readonly baseImage: string;
  readonly aptPackages: readonly string[];
}

/** Tools and skills to install in Stage 2 (custom layer). */
export interface Stage2Config {
  readonly binaries: readonly BinaryInstall[];
  readonly workspaceTools: readonly string[];
  readonly skills: readonly string[];
  /** Install 1Password CLI (op) for credential vault access. */
  readonly enableOnePassword?: boolean;
  /** Workspace mutability manifest — when present, immutable files are baked into the image layer. */
  readonly workspace?: WorkspaceManifest;
  /**
   * Security posture at compile time. Included in the stage 2 hash so a
   * posture change (hardened → under-attack) invalidates the cache even if
   * no other input changed. Without this, the compose file is regenerated
   * with new posture settings but the image keeps its prior tmpfs/gvisor/
   * healthcheck shape because stage 2 cache-hits.
   */
  readonly posture?: BuildSecurityPosture;
}

/** Binary to install from a GitHub release or URL. */
export interface BinaryInstall {
  readonly name: string;
  readonly url: string;
  readonly destPath: string;
  /** Pinned SHA256 hash for supply-chain verification. */
  readonly sha256: string;
}

/** Options for the build command. */
export interface BuildOptions {
  readonly deployDir: string;
  readonly posture?: BuildSecurityPosture;
  readonly stage1: Stage1Config;
  readonly stage2: Stage2Config;
  readonly noCache?: boolean;
  /** Instance name for multi-agent deployments. Defaults to 'default'. */
  readonly instanceName?: string;
}

// ── Build Manifest ──────────────────────────────────────────────────────────

/** Layer information in a build manifest. */
export interface ManifestLayer {
  readonly id: string;
  readonly stage: "stage1" | "stage2";
  readonly sizeBytes: number;
  readonly createdAt: string;
}

/** Build manifest written after a successful build. */
export interface BuildManifest {
  readonly imageId: string;
  readonly imageTag: string;
  readonly imageHash: string;
  readonly layers: readonly ManifestLayer[];
  readonly totalSizeBytes: number;
  readonly posture: BuildSecurityPosture;
  readonly stage1Hash: string;
  readonly stage2Hash: string;
  readonly builtAt: string;
  readonly builderVersion: string;
}

// ── Cache Detection ─────────────────────────────────────────────────────────

/** Result of hash-based change detection. */
export interface CacheCheckResult {
  readonly stage1Changed: boolean;
  readonly stage2Changed: boolean;
  readonly currentStage1Hash: string;
  readonly currentStage2Hash: string;
  readonly previousStage1Hash: string | null;
  readonly previousStage2Hash: string | null;
}

// ── Build Result ────────────────────────────────────────────────────────────

/** Result of a build operation. */
export interface BuildResult {
  readonly success: boolean;
  readonly manifest: BuildManifest | null;
  readonly cacheHit: {
    readonly stage1: boolean;
    readonly stage2: boolean;
  };
  readonly error?: string;
}

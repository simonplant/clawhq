/**
 * Types for Docker two-stage build and container hardening.
 *
 * Covers build configuration, security postures, build manifests,
 * and cache detection for the `clawhq build` command.
 */

// ── Security Posture ────────────────────────────────────────────────────────

/** Security posture level. Includes "minimal" for development use. */
export type BuildSecurityPosture = "minimal" | "standard" | "hardened" | "paranoid";

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
}

/** Binary to install from a GitHub release or URL. */
export interface BinaryInstall {
  readonly name: string;
  readonly url: string;
  readonly destPath: string;
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

/**
 * OpenClaw source acquisition and version pinning types.
 */

export interface SourceConfig {
  /** Git repository URL. */
  repo: string;
  /** Pinned version tag (e.g., "v0.14.2"). */
  version: string;
  /** Local cache directory for cloned source. */
  cacheDir: string;
}

export interface SourceStatus {
  /** Whether source is cached locally. */
  cached: boolean;
  /** The pinned version from config. */
  pinnedVersion: string;
  /** The version present in cache (if any). */
  cachedVersion: string | null;
  /** Whether pinned and cached versions match. */
  versionMatch: boolean;
  /** Whether integrity check passed. */
  integrityOk: boolean;
  /** Absolute path to cached source directory. */
  sourcePath: string;
  /** SHA256 hash of the source tree (if cached). */
  treeHash: string | null;
}

export interface AcquireResult {
  /** Whether acquisition succeeded. */
  success: boolean;
  /** Path to the acquired source directory. */
  sourcePath: string;
  /** Version tag that was acquired. */
  version: string;
  /** SHA256 tree hash of the acquired source. */
  treeHash: string;
  /** Whether this was a cache hit (skipped download). */
  cacheHit: boolean;
  /** Duration of the operation in ms. */
  durationMs: number;
}

export interface AcquireOptions {
  /** Force re-acquisition even if cache matches. */
  force?: boolean;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

/**
 * OpenClaw source acquisition and version pinning.
 *
 * Public API for acquiring, verifying, and checking status of
 * the OpenClaw source code used for container builds.
 */

export {
  acquireSource,
  CloneFailed,
  computeTreeHash,
  getSourceStatus,
  IntegrityCheckFailed,
  readStoredHash,
  resolveSourceConfig,
  SourceError,
  VersionMismatch,
  VersionNotPinned,
  verifySource,
  versionDir,
} from "./acquire.js";

export type {
  AcquireOptions,
  AcquireResult,
  SourceConfig,
  SourceStatus,
} from "./types.js";

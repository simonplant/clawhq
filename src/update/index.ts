/**
 * Safe upstream update — clawhq update.
 *
 * Public API for the update module.
 */

export { fetchChangelog, formatChangelog, hasBreakingChanges } from "./changelog.js";
export { rollback } from "./rollback.js";
export type {
  ChangelogEntry,
  ChangelogResult,
  ReleaseInfo,
  RollbackOptions,
  RollbackResult,
  UpdateError,
  UpdateOptions,
  UpdateResult,
  VersionCheckResult,
} from "./types.js";
export { formatCheckResult, runUpdate } from "./update.js";
export { checkForUpdate, fetchLatestRelease, fetchReleasesSince } from "./version-check.js";

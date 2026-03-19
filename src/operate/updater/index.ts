/**
 * Safe upstream updates — public API.
 */

export { applyUpdate, checkForUpdates } from "./updater.js";
export type {
  UpdateCheckResult,
  UpdateOptions,
  UpdateProgress,
  UpdateProgressCallback,
  UpdateResult,
  UpdateStep,
  UpdateStepStatus,
} from "./types.js";

/**
 * Update intelligence system — public API.
 *
 * Change intelligence, versioned migrations,
 * update channels, and automatic rollback.
 */

// Core updater
export { applyUpdate, checkForUpdates } from "./updater.js";

// CalVer version utilities
export { compareCalVer, compareVersions, formatCalVer, parseCalVer, sortVersions } from "./calver.js";
export type { CalVer } from "./calver.js";

// Change intelligence
export { analyzeUpdate, classifyRelease, fetchReleaseNotes, generateRecommendation } from "./intelligence.js";

// Update channels
export { resolveTargetVersion } from "./channels.js";


// Terminal formatting
export { formatIntelligenceJson, formatIntelligenceReport, formatMigrationPlan } from "./format.js";

// Migrations
export {
  buildMigrationPlan,
  buildMigrationPlanFrom,
  createMigrationContext,
  executeMigrationPlan,
  isConfigOnlyPlan,
  rollbackMigrations,
} from "./migrations/index.js";
export type {
  Migration,
  MigrationChange,
  MigrationContext,
  MigrationPlan,
  MigrationResult,
  MigrationStepResult,
} from "./migrations/index.js";

// Types
export type {
  ChangeIntelligenceReport,
  ReleaseClassification,
  UpdateChannel,
  UpdateCheckResult,
  UpdateOptions,
  UpdateProgress,
  UpdateProgressCallback,
  UpdateRecommendation,
  UpdateResult,
  UpdateStep,
  UpdateStepStatus,
} from "./types.js";

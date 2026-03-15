/**
 * Autonomy tuning from approval patterns.
 *
 * Analyzes the approval queue history to identify categories where
 * the agent's autonomy level should be adjusted:
 *
 * - Categories with >95% approval rate: recommend auto-approve
 * - Categories with >50% rejection rate: recommend require-approval
 *
 * Rejected recommendations enter a cooldown period before being re-proposed.
 * All changes are logged for audit trail.
 */

export type {
  AutonomyAuditEntry,
  AutonomyAuditLog,
  AutonomyAuditEventType,
  AutonomyConfig,
  AutonomyContext,
  AutonomyRecommendation,
  CategoryStats,
  CooldownEntry,
  RecommendationStore,
  RecommendationType,
} from "./types.js";
export { DEFAULT_AUTONOMY_CONFIG } from "./types.js";

export { computeCategoryStats, trackPatterns } from "./tracker.js";

export { analyzePatterns, computeConfidence, isInCooldown } from "./analyzer.js";

export {
  acceptRecommendation,
  AutonomyError,
  formatDryRun,
  formatRecommendations,
  generateRecommendations,
  loadAuditLog,
  loadStore,
  logAuditEvent,
  rejectRecommendation,
  saveStore,
} from "./recommender.js";

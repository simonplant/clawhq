/**
 * Skills module — skill lifecycle management with security vetting.
 *
 * Skills follow a strict pipeline: stage → vet → approve → activate.
 * Every installation creates a rollback snapshot. Malicious URL patterns
 * and other threats are caught during vetting.
 */

// Lifecycle pipeline
export { installSkill, loadManifest, removeSkill } from "./lifecycle.js";

// Vetting
export { vetSkill } from "./vet.js";

// Staging
export { readStagedFiles, stageSkill } from "./stage.js";

// Rollback
export {
  createSnapshot,
  listSnapshots,
  restoreLatestSnapshot,
  restoreSnapshot,
} from "./rollback.js";

// List
export { formatSkillList, formatSkillListJson, listSkills } from "./list.js";

// Types
export type {
  RollbackSnapshot,
  SkillInstallOptions,
  SkillInstallResult,
  SkillListOptions,
  SkillManifest,
  SkillManifestEntry,
  SkillPipelineStep,
  SkillProgress,
  SkillProgressCallback,
  SkillStatus,
  SkillStepStatus,
  VetFinding,
  VetFindingCategory,
  VetReport,
  VetSeverity,
  VetSummary,
} from "./types.js";

/**
 * Skills module — skill lifecycle management with security vetting.
 *
 * Skills follow a strict pipeline: stage → vet → approve → activate.
 * Every installation creates a rollback snapshot. Malicious URL patterns
 * and other threats are caught during vetting.
 */

// Lifecycle pipeline
export { installSkill, loadManifest, removeSkill, updateAllSkills, updateSkill } from "./lifecycle.js";

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

// Construct meta-skill
export {
  assessGaps,
  CONSTRUCT_PHASE_ORDER,
  deployConstructedSkill,
  filterNewProposals,
  getConstructStatus,
  runConstructCycle,
  validateDeployedSkill,
  writeArtifact,
} from "./construct/index.js";

export {
  assessedGapIds,
  builtSkillNames,
  emptyState as emptyConstructState,
  loadConstructState,
  proposedSkillNames,
  recordArtifact,
  recordCycle,
  recordGaps,
  recordProposal,
  saveConstructState,
} from "./construct/index.js";

export type {
  ConstructArtifact,
  ConstructCycle,
  ConstructGap,
  ConstructPhase,
  ConstructPhaseResult,
  ConstructPhaseStatus,
  ConstructProgress,
  ConstructProgressCallback,
  ConstructProposal,
  ConstructRunOptions,
  ConstructRunResult,
  ConstructState,
  GapPriority,
  SkillBoundaries,
} from "./construct/index.js";

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
  SkillUpdateResult,
  VetFinding,
  VetFindingCategory,
  VetReport,
  VetSeverity,
  VetSummary,
} from "./types.js";

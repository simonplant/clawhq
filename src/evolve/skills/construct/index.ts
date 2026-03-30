/**
 * Construct meta-skill — autonomous self-improvement loop.
 *
 * Assess → Propose → Build → Deploy → Validate.
 * State persists across runs. Construct-built skills pass the same
 * vetting pipeline as manually installed skills.
 */

// Orchestrator
export {
  assessGaps,
  deployConstructedSkill,
  filterNewProposals,
  getConstructStatus,
  runConstructCycle,
  validateDeployedSkill,
  writeArtifact,
} from "./construct.js";

// State persistence
export {
  assessedGapIds,
  builtSkillNames,
  emptyState,
  loadConstructState,
  proposedSkillNames,
  recordArtifact,
  recordCycle,
  recordGaps,
  recordProposal,
  saveConstructState,
} from "./state.js";

// Types
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
} from "./types.js";

export { CONSTRUCT_PHASE_ORDER } from "./types.js";

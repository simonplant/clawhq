/**
 * Skill management — install, list, update, remove agent skills safely.
 */

export { formatCatalogInfo, formatCatalogSearch } from "./catalog-format.js";
export type { BuiltinSkillEntry } from "./catalog.js";
export { BUILTIN_SKILLS, findCatalogSkill, searchCatalog } from "./catalog.js";
export { formatSkillList, formatSkillSummary } from "./format.js";
export {
  activateSkill,
  applySkillUpdate,
  removeSkillOp,
  resolveSource,
  rollbackSkill,
  stageSkillInstall,
  stageSkillUpdate,
} from "./lifecycle.js";
export type { InstallResult, RemoveResult, UpdateResult } from "./lifecycle.js";
export { findSkill, loadRegistry } from "./registry.js";
export { createSnapshot, loadSnapshot } from "./snapshot.js";
export type { SkillSnapshot } from "./snapshot.js";
export type {
  InstalledSkill,
  SkillContext,
  SkillError,
  SkillManifest,
  SkillRegistry,
  SkillSource,
  SkillStatus,
  VetResult,
  VetWarning,
} from "./types.js";
export { formatVetResult, vetSkill } from "./vet.js";

/**
 * Blueprint loader, validator, and choice converter.
 *
 * The blueprint module is the read path for the entire blueprint engine.
 * It loads YAML blueprints (built-in or community), validates them with
 * 70+ structural and security checks, and converts them into wizard choices.
 */

// Types
export type {
  AutonomyModel,
  Blueprint,
  BlueprintChoice,
  BlueprintSecurityPosture,
  BlueprintValidationReport,
  BlueprintValidationResult,
  BlueprintValidationSeverity,
  Channels,
  CronConfig,
  IntegrationRequirements,
  MemoryPolicy,
  ModelRoutingStrategy,
  Monitoring,
  OnePasswordConfig,
  Personality,
  SkillBundle,
  SkillEntry,
  ToolEntry,
  Toolbelt,
  UseCaseMapping,
} from "./types.js";

// Delegation types
export type {
  CompiledDelegationRules,
  DelegatedActionRules,
  DelegationCategory,
  DelegationMatch,
  DelegationRuleEntry,
} from "./delegation-types.js";
export { matchGlob } from "./delegation-types.js";

// Profiles
export type { MissionProfileDefaults, MissionProfileId } from "./profiles.js";
export { isValidProfileId, mergeProfileDeny, MISSION_PROFILE_DEFAULTS, MISSION_PROFILE_IDS } from "./profiles.js";

// Delegation defaults
export { APPOINTMENT_CONFIRM, EMAIL_DELEGATION_DEFAULTS, UNSUBSCRIBE, VENDOR_REPLY } from "./delegation-defaults.js";

// Loader
export {
  BlueprintLoadError,
  BlueprintParseError,
  BlueprintSizeError,
  BlueprintValidationError,
  listBuiltinBlueprints,
  loadAllBuiltinBlueprints,
  loadBlueprint,
  loadBlueprintFile,
} from "./loader.js";
export type { LoadedBlueprint } from "./loader.js";

// Validation
export { validateBlueprint } from "./validate.js";

// Choice conversion
export { allTemplatesToChoices, templateToChoice } from "./choice.js";

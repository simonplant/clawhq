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

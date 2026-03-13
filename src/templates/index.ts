/**
 * Template system — YAML-based operational profiles for OpenClaw agents.
 *
 * Templates are full operational profiles (personality, security, monitoring,
 * memory, cron, autonomy, model routing, integrations, skills) stored as
 * YAML files. They map use-cases ("Replace Google Assistant") to concrete
 * agent configurations.
 *
 * See docs/ARCHITECTURE.md → Layer 2 (Templates).
 */

export type {
  Template,
  TemplatePersonality,
  TemplateSecurityPosture,
  TemplateMonitoring,
  TemplateMemoryPolicy,
  TemplateCronConfig,
  TemplateAutonomyModel,
  TemplateModelRoutingStrategy,
  TemplateIntegrationRequirements,
  TemplateSkillBundle,
  TemplatePreview,
  TemplateLoadResult,
  TemplateValidationError,
} from "./types.js";

export {
  LAYER1_SECURITY_BASELINE,
  POSTURE_STRICTNESS,
  EGRESS_STRICTNESS,
} from "./types.js";

export {
  loadTemplate,
  loadTemplateFromString,
  loadBuiltInTemplates,
  loadTemplatesFromDirectory,
  getBuiltInTemplatesDir,
} from "./loader.js";

export {
  generatePreview,
  formatPreview,
  formatTemplateList,
} from "./preview.js";

export {
  mapTemplateToConfig,
} from "./mapper.js";

export type {
  MapperAnswers,
  MapperIntegration,
  MapperCloudProvider,
  MapperResult,
} from "./mapper.js";

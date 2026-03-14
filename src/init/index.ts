/**
 * Init wizard — `clawhq init --guided` questionnaire.
 *
 * Re-exports the public API for the init module.
 */

export { runWizard, type WizardResult } from "./wizard.js";
export { generate, type GeneratedConfig } from "./generate.js";
export { writeBundle, type WriteResult } from "./writer.js";
export { formatSummary } from "./summary.js";
export { getBuiltInTemplates, getTemplateById, formatTemplateList } from "./templates.js";
export { createReadlineIO } from "./readline-io.js";
export {
  stepBasics,
  stepIntegrations,
  stepModelRouting,
  stepTemplate,
} from "./steps.js";
export type {
  WizardAnswers,
  WizardBasics,
  WizardIO,
  TemplateChoice,
  IntegrationSetup,
  ModelRoutingSetup,
  PromptFn,
  SelectFn,
  ConfirmFn,
} from "./types.js";

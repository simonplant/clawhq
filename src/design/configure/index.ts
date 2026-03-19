/**
 * Configure module — setup wizard, config generator, and atomic writer.
 *
 * This module implements `clawhq init --guided`: the interactive path from
 * blueprint selection to a valid, landmine-free deployment config.
 */

// Types
export type {
  FileEntry,
  GenerateOptions,
  WizardAnswers,
  WizardOptions,
  WriteResult,
} from "./types.js";

// Wizard
export {
  createInquirerPrompter,
  runWizard,
  WizardAbortError,
  WizardError,
} from "./wizard.js";
export type { Prompter } from "./wizard.js";

// Generator
export { generateBundle, generateIdentityFiles } from "./generate.js";
export type { IdentityFileContent } from "./generate.js";

// Writer
export { writeBundle, writeFileAtomic, WriteError } from "./writer.js";

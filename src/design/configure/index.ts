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
export { generateBundle, generateIdentityFiles, generateToolFiles } from "./generate.js";
export type { IdentityFileContent } from "../identity/index.js";
export type { ToolFileContent } from "../tools/index.js";

// Smart inference
export {
  runSmartInference,
  SmartInferenceAbortError,
  SmartInferenceError,
} from "./smart.js";

// Ollama client
export { isOllamaAvailable, OllamaError } from "./ollama.js";

// Writer
export { writeBundle, writeFileAtomic, WriteError } from "./writer.js";

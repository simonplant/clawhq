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
  UserContext,
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

// Generator — public surface. generateBundle is kept for web/server.tsx's
// /init flow; generateIdentityFiles is kept for web + demo. The old
// per-section generators (generateToolFiles, generateSkillFiles,
// generateAllowlistContent, generateDelegatedRulesContent, and the former
// generateWorkspaceManifest) lived here from the pre-apply() compile path
// and have no production consumer — not re-exported to keep the public
// surface in line with actual callers.
export { generateBundle, generateIdentityFiles, renderCronJobsFile, scanWorkspaceManifest } from "./generate.js";
export type { IdentityFileContent } from "../identity/index.js";
export type { SkillFileEntry } from "../skills/index.js";
export type { ToolFileContent } from "../tools/index.js";

// Smart inference
export {
  runSmartInference,
  SmartInferenceAbortError,
  SmartInferenceError,
} from "./smart.js";

// Ollama client
export { isOllamaAvailable, OllamaError } from "./ollama.js";

// Config file (non-interactive)
export { isCompositionConfig, loadAndCompileComposition, loadConfigFile, ConfigFileError } from "./config-file.js";

// Writer
export { filesForFreshInstall, writeBundle } from "./writer.js";

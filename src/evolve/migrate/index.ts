/**
 * Migration import module — ChatGPT + Google Assistant data import.
 *
 * Parses export data from big-tech assistants, extracts preferences
 * via local Ollama, maps routines to cron jobs, and masks PII.
 * All processing is local — zero network calls.
 */

// Orchestrator
export { runMigration } from "./migrate.js";

// Parsers
export { parseChatGPTExport } from "./chatgpt-parser.js";
export { parseGoogleAssistantExport } from "./google-parser.js";

// Preference extraction
export { extractPreferences } from "./extract.js";

// Cron mapping
export { mapRoutinesToCron } from "./cron-mapper.js";

// Types
export type {
  ChatGPTConversation,
  ChatGPTMessage,
  ChatGPTNode,
  CronMappingResult,
  ExtractedPreference,
  ExtractionResult,
  GoogleAssistantActivity,
  GoogleAssistantRoutine,
  GoogleAssistantRoutineAction,
  MappedCronJob,
  MigrationOptions,
  MigrationProgress,
  MigrationProgressCallback,
  MigrationResult,
  MigrationSource,
  MigrationStep,
  MigrationStepStatus,
  ParsedMessage,
  ParsedRoutine,
  ParseResult,
} from "./types.js";

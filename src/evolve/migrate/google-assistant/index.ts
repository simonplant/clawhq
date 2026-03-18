/**
 * Google Assistant routine import — migrate from Google Assistant to ClawHQ.
 *
 * Parses Google Takeout exports containing routine definitions, converts
 * schedule-based routines to OpenClaw cron job format, flags Google-specific
 * actions with suggested alternatives, and writes approved jobs to cron/jobs.json.
 */

export type {
  ConversionResult,
  GoogleActionType,
  GoogleAssistantParseResult,
  RoutineAction,
  RoutineEntry,
  RoutineTrigger,
  RoutineTriggerType,
  UnmappableAction,
} from "./types.js";

export { parseGoogleAssistantExport } from "./parser.js";

export {
  buildCronExpression,
  convertRoutine,
  convertRoutines,
  suggestAlternative,
} from "./converter.js";

export { readExistingJobs, writeCronJobs } from "./writer.js";

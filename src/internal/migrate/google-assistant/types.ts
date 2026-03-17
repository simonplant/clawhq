/**
 * Google Assistant routine import types.
 *
 * Supports parsing Google Takeout exports containing routine definitions
 * and converting them to OpenClaw cron job format.
 */

/** Trigger type for a Google Assistant routine. */
export type RoutineTriggerType = "voice" | "schedule" | "sunrise" | "sunset" | "android_alarm";

/** A trigger that initiates a routine. */
export interface RoutineTrigger {
  type: RoutineTriggerType;
  /** Voice command phrase (when type === "voice"). */
  phrase?: string;
  /** Time of day in HH:MM format (when type === "schedule"). */
  time?: string;
  /** Days of week (when type === "schedule"). */
  days?: string[];
  /** IANA timezone. */
  timezone?: string;
}

/** Known Google Assistant action types. */
export type GoogleActionType =
  | "tell_weather"
  | "tell_calendar_events"
  | "tell_reminders"
  | "tell_commute"
  | "tell_news"
  | "read_messages"
  | "send_message"
  | "adjust_lights"
  | "adjust_thermostat"
  | "control_device"
  | "play_media"
  | "set_alarm"
  | "broadcast"
  | "custom_command";

/** A single action within a routine. */
export interface RoutineAction {
  type: GoogleActionType | string;
  /** Optional parameters for the action. */
  params?: Record<string, unknown>;
  /** Custom command text (when type === "custom_command"). */
  command?: string;
}

/** A parsed Google Assistant routine. */
export interface RoutineEntry {
  id: string;
  name: string;
  trigger: RoutineTrigger;
  actions: RoutineAction[];
  enabled: boolean;
}

/** Result of parsing a Google Takeout export for routines. */
export interface GoogleAssistantParseResult {
  routines: RoutineEntry[];
  /** Path within the Takeout archive where routines were found. */
  sourcePath: string;
}

/** Result of converting a routine to a cron job. */
export interface ConversionResult {
  /** The routine that was converted. */
  routine: RoutineEntry;
  /** Whether the routine could be mapped to a cron job. */
  mappable: boolean;
  /** The generated cron job (when mappable). */
  cronJob?: import("../../../config/schema.js").CronJobDefinition;
  /** Actions that couldn't be directly mapped. */
  unmappableActions: UnmappableAction[];
  /** Reason the routine is unmappable (when !mappable). */
  reason?: string;
}

/** An action that can't be directly mapped, with a suggested alternative. */
export interface UnmappableAction {
  action: RoutineAction;
  reason: string;
  suggestion: string;
}

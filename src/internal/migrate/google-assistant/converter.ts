/**
 * Google Assistant routine → OpenClaw cron job converter.
 *
 * Converts schedule-based routines to CronJobDefinition format.
 * Flags Google-specific actions (smart home, device control, media playback)
 * as unmappable with suggested OpenClaw-native alternatives.
 */

import type { CronJobDefinition } from "../../../config/schema.js";

import type {
  ConversionResult,
  RoutineAction,
  RoutineEntry,
  UnmappableAction,
} from "./types.js";

/** Day-of-week name → cron DOW index (0=Sunday). */
const DAY_MAP: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

/**
 * Map of Google Assistant action types to OpenClaw-native alternative suggestions.
 */
const ALTERNATIVE_MAP: Record<string, { reason: string; suggestion: string }> = {
  adjust_lights: {
    reason: "Requires Google Home smart home API",
    suggestion: "Use Home Assistant integration for smart home control",
  },
  adjust_thermostat: {
    reason: "Requires Google Home smart home API",
    suggestion: "Use Home Assistant integration for thermostat control",
  },
  control_device: {
    reason: "Requires Google Home smart home API",
    suggestion: "Use Home Assistant integration for device control",
  },
  play_media: {
    reason: "Requires Google Cast / media playback API",
    suggestion: "Use a media control CLI tool or Home Assistant media player integration",
  },
  broadcast: {
    reason: "Requires Google Home broadcast feature",
    suggestion: "Send a Telegram/messaging channel notification instead",
  },
  set_alarm: {
    reason: "Requires Android alarm API",
    suggestion: "Use a cron job with notification via messaging channel",
  },
  tell_commute: {
    reason: "Requires Google Maps commute data",
    suggestion: "Use a web research tool to check traffic conditions",
  },
  send_message: {
    reason: "Requires Google messaging integration",
    suggestion: "Use email tool or messaging channel to send messages",
  },
  read_messages: {
    reason: "Requires Google messaging integration",
    suggestion: "Use email tool to read and summarize messages",
  },
};

/**
 * Map of Google Assistant action types to cron task prompt fragments.
 */
const TASK_MAP: Record<string, string> = {
  tell_weather: "Check the weather forecast and provide a summary",
  tell_calendar_events: "Review today's calendar and summarize upcoming events",
  tell_reminders: "Check pending reminders and list any due items",
  tell_news: "Gather top news headlines and provide a brief summary",
};

/**
 * Suggest an OpenClaw-native alternative for a Google-specific action.
 */
export function suggestAlternative(
  action: RoutineAction,
): UnmappableAction | null {
  const alt = ALTERNATIVE_MAP[action.type];
  if (alt) {
    return { action, reason: alt.reason, suggestion: alt.suggestion };
  }

  // Unknown action types are flagged as unmappable
  if (!TASK_MAP[action.type] && action.type !== "custom_command") {
    return {
      action,
      reason: `Unknown Google Assistant action type: ${action.type}`,
      suggestion: "Convert manually to a custom cron task prompt",
    };
  }

  return null;
}

/**
 * Build a cron task prompt from a list of mappable actions.
 */
function buildTaskPrompt(routine: RoutineEntry, mappableActions: RoutineAction[]): string {
  const parts: string[] = [];

  for (const action of mappableActions) {
    if (action.type === "custom_command" && action.command) {
      parts.push(action.command);
    } else {
      const mapped = TASK_MAP[action.type];
      if (mapped) parts.push(mapped);
    }
  }

  if (parts.length === 0) return "";

  if (parts.length === 1) {
    return parts[0];
  }

  return `${routine.name}: ${parts.join(". ")}.`;
}

/**
 * Convert a time string (HH:MM) and optional days to a 5-field cron expression.
 */
export function buildCronExpression(
  time: string,
  days?: string[],
): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return null;

  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  let dow = "*";
  if (days && days.length > 0 && days.length < 7) {
    const indices = days
      .map((d) => DAY_MAP[d.toLowerCase()])
      .filter((n): n is number => n !== undefined);
    if (indices.length > 0) {
      dow = indices.sort((a, b) => a - b).join(",");
    }
  }

  return `${minute} ${hour} * * ${dow}`;
}

/**
 * Generate a stable cron job ID from a routine.
 */
function generateCronId(routine: RoutineEntry): string {
  const slug = routine.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
  return `ga-${slug || routine.id}`;
}

/**
 * Convert a single Google Assistant routine to a cron job definition.
 */
export function convertRoutine(routine: RoutineEntry): ConversionResult {
  const unmappableActions: UnmappableAction[] = [];
  const mappableActions: RoutineAction[] = [];

  for (const action of routine.actions) {
    const alt = suggestAlternative(action);
    if (alt) {
      unmappableActions.push(alt);
    } else {
      mappableActions.push(action);
    }
  }

  // Voice-only and non-schedule triggers can't become cron jobs
  if (routine.trigger.type !== "schedule") {
    return {
      routine,
      mappable: false,
      unmappableActions,
      reason: `Trigger type "${routine.trigger.type}" cannot be converted to a cron schedule. ` +
        "Only time-scheduled routines can be mapped. " +
        "Consider creating a manual cron job for this routine's actions.",
    };
  }

  // Must have a time for schedule triggers
  if (!routine.trigger.time) {
    return {
      routine,
      mappable: false,
      unmappableActions,
      reason: "Schedule trigger has no time configured.",
    };
  }

  const expr = buildCronExpression(routine.trigger.time, routine.trigger.days);
  if (!expr) {
    return {
      routine,
      mappable: false,
      unmappableActions,
      reason: `Invalid time format: ${routine.trigger.time}. Expected HH:MM.`,
    };
  }

  const task = buildTaskPrompt(routine, mappableActions);
  if (!task) {
    return {
      routine,
      mappable: false,
      unmappableActions,
      reason: "No mappable actions found — all actions require Google-specific APIs.",
    };
  }

  const cronJob: CronJobDefinition = {
    id: generateCronId(routine),
    kind: "cron",
    expr,
    task,
    enabled: routine.enabled,
    delivery: "announce",
    session: "isolated",
  };

  // Add active hours from timezone if available
  if (routine.trigger.timezone) {
    cronJob.activeHours = {
      start: 0,
      end: 23,
      tz: routine.trigger.timezone,
    };
  }

  return {
    routine,
    mappable: true,
    cronJob,
    unmappableActions,
  };
}

/**
 * Convert all routines and return conversion results.
 */
export function convertRoutines(routines: RoutineEntry[]): ConversionResult[] {
  return routines.map(convertRoutine);
}

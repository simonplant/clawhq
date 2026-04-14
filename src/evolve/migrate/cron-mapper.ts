/**
 * Routine-to-cron mapper.
 *
 * Translates routines extracted from ChatGPT/Google Assistant exports
 * into OpenClaw-native cron job definitions. The key value-add of
 * migration import — not just importing preferences but translating
 * them into scheduled jobs.
 *
 * All mapping is deterministic and local.
 */

import type { CronJobDefinition } from "../../config/types.js";

import type {
  CronMappingResult,
  MappedCronJob,
  ParsedRoutine,
} from "./types.js";

// ── Schedule Pattern Mapping ─────────────────────────────────────────────────

interface ScheduleMapping {
  readonly pattern: RegExp;
  readonly expr: string;
  readonly delivery: "none" | "announce";
}

/**
 * Map natural-language schedule hints to cron expressions.
 * Ordered by specificity — more specific patterns first.
 */
const SCHEDULE_MAPPINGS: readonly ScheduleMapping[] = [
  // Specific times: "HH:MM" format
  { pattern: /^(\d{1,2}):(\d{2})$/, expr: "TIME", delivery: "announce" },

  // Time of day
  { pattern: /^morning$/i, expr: "0 7 * * *", delivery: "announce" },
  { pattern: /^evening$/i, expr: "0 19 * * *", delivery: "announce" },
  { pattern: /^afternoon$/i, expr: "0 14 * * *", delivery: "announce" },
  { pattern: /^night$/i, expr: "0 21 * * *", delivery: "announce" },

  // Frequency
  { pattern: /^daily$/i, expr: "0 8 * * *", delivery: "none" },
  { pattern: /^weekly$/i, expr: "0 9 * * 1", delivery: "announce" },
  { pattern: /^monthly$/i, expr: "0 9 1 * *", delivery: "announce" },
  { pattern: /^hourly$/i, expr: "0 * * * *", delivery: "none" },

  // Every N minutes/hours
  { pattern: /every\s+(\d+)\s*min/i, expr: "EVERY_MIN", delivery: "none" },
  { pattern: /every\s+(\d+)\s*hour/i, expr: "EVERY_HOUR", delivery: "none" },
];

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Map parsed routines to OpenClaw cron job definitions.
 *
 * Each routine's schedule hint is matched against known patterns.
 * Routines that can't be mapped are returned in `unmapped`.
 */
export function mapRoutinesToCron(
  routines: readonly ParsedRoutine[],
): CronMappingResult {
  const mappings: MappedCronJob[] = [];
  const unmapped: ParsedRoutine[] = [];

  for (const routine of routines) {
    const cronJob = buildCronJob(routine);
    if (cronJob) {
      mappings.push({ routine, cronJob });
    } else {
      unmapped.push(routine);
    }
  }

  return {
    success: true,
    mappings,
    unmapped,
  };
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

/** Build a cron job from a parsed routine. Returns null if unmappable. */
function buildCronJob(routine: ParsedRoutine): CronJobDefinition | null {
  const expr = resolveSchedule(routine.schedule);
  if (!expr) return null;

  const delivery = resolveDelivery(routine.schedule);
  const id = sanitizeId(routine.name);

  const jobId = `import-${id}`;
  return {
    id: jobId,
    name: jobId,
    enabled: true,
    schedule: { kind: "cron" as const, expr },
    delivery: { mode: delivery },
    payload: {
      kind: "agentTurn" as const,
      message: routine.description.slice(0, 200),
    },
    sessionTarget: "main" as const,
  };
}

/** Resolve a schedule hint to a cron expression. */
function resolveSchedule(schedule: string): string | null {
  for (const mapping of SCHEDULE_MAPPINGS) {
    const match = schedule.match(mapping.pattern);
    if (!match) continue;

    if (mapping.expr === "TIME" && match[1] && match[2]) {
      // Specific time: "HH:MM" → "MM HH * * *"
      const hour = parseInt(match[1], 10);
      const minute = parseInt(match[2], 10);
      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        return `${minute} ${hour} * * *`;
      }
      continue;
    }

    if (mapping.expr === "EVERY_MIN" && match[1]) {
      const mins = parseInt(match[1], 10);
      if (mins > 0 && mins <= 59) {
        return `*/${mins} * * * *`;
      }
      continue;
    }

    if (mapping.expr === "EVERY_HOUR" && match[1]) {
      const hours = parseInt(match[1], 10);
      if (hours > 0 && hours <= 23) {
        return `0 */${hours} * * *`;
      }
      continue;
    }

    return mapping.expr;
  }

  // Fallback: try parsing as a raw time
  const timeMatch = schedule.match(/(\d{1,2}):(\d{2})/);
  if (timeMatch && timeMatch[1] && timeMatch[2]) {
    const hour = parseInt(timeMatch[1], 10);
    const minute = parseInt(timeMatch[2], 10);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${minute} ${hour} * * *`;
    }
  }

  return null;
}

/** Resolve the delivery mode for a schedule. */
function resolveDelivery(schedule: string): "none" | "announce" {
  for (const mapping of SCHEDULE_MAPPINGS) {
    if (mapping.pattern.test(schedule)) {
      return mapping.delivery;
    }
  }
  return "none";
}

/** Sanitize a routine name into a valid cron job ID. */
function sanitizeId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "routine";
}

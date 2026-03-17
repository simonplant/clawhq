/**
 * Google Takeout export parser for Google Assistant routines.
 *
 * Parses the ZIP file or extracted directory from Google Takeout.
 * Looks for routine definitions in known Takeout directory structures.
 * Uses `unzip` subprocess for ZIP extraction (consistent with ChatGPT parser).
 */

import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { MigrateError } from "../types.js";

import type {
  GoogleAssistantParseResult,
  GoogleActionType,
  RoutineAction,
  RoutineEntry,
  RoutineTrigger,
  RoutineTriggerType,
} from "./types.js";

const execFileAsync = promisify(execFile);

/** Known paths within Google Takeout where routines may live. */
const ROUTINE_PATHS = [
  "Google Assistant/Routines",
  "Takeout/Google Assistant/Routines",
  "Google Assistant",
  "Takeout/Google Assistant",
];

/** Known routine file names. */
const ROUTINE_FILES = ["routines.json", "Routines.json"];

/**
 * Extract a ZIP file to a temporary directory.
 */
async function extractZip(zipPath: string): Promise<string> {
  const extractDir = join(tmpdir(), `clawhq-ga-migrate-${Date.now()}`);

  try {
    await execFileAsync("unzip", ["-o", "-q", zipPath, "-d", extractDir]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new MigrateError(
      `Failed to extract ZIP file: ${msg}`,
      "ZIP_EXTRACT_FAILED",
    );
  }

  return extractDir;
}

/**
 * Recursively search for routine files within a directory.
 */
async function findRoutineFile(baseDir: string): Promise<string | null> {
  // Check known paths first
  for (const routinePath of ROUTINE_PATHS) {
    const dir = join(baseDir, routinePath);
    try {
      const s = await stat(dir);
      if (s.isDirectory()) {
        for (const fileName of ROUTINE_FILES) {
          const filePath = join(dir, fileName);
          try {
            const fs = await stat(filePath);
            if (fs.isFile()) return filePath;
          } catch {
            // File doesn't exist at this path, try next
          }
        }

        // Check for any .json file in the routines directory
        const entries = await readdir(dir);
        const jsonFiles = entries.filter((e) => e.endsWith(".json"));
        if (jsonFiles.length > 0) {
          return join(dir, jsonFiles[0]);
        }
      }
    } catch {
      // Directory doesn't exist, try next
    }
  }

  // Check for routine files directly in the base directory
  for (const fileName of ROUTINE_FILES) {
    const filePath = join(baseDir, fileName);
    try {
      const fs = await stat(filePath);
      if (fs.isFile()) return filePath;
    } catch {
      // Not found, continue
    }
  }

  return null;
}

const VALID_TRIGGER_TYPES = new Set<string>([
  "voice",
  "schedule",
  "sunrise",
  "sunset",
  "android_alarm",
]);

const VALID_ACTION_TYPES = new Set<string>([
  "tell_weather",
  "tell_calendar_events",
  "tell_reminders",
  "tell_commute",
  "tell_news",
  "read_messages",
  "send_message",
  "adjust_lights",
  "adjust_thermostat",
  "control_device",
  "play_media",
  "set_alarm",
  "broadcast",
  "custom_command",
]);

/**
 * Normalize a raw trigger object from the export.
 */
function normalizeTrigger(raw: Record<string, unknown>): RoutineTrigger {
  const type = (typeof raw.type === "string" && VALID_TRIGGER_TYPES.has(raw.type)
    ? raw.type
    : "voice") as RoutineTriggerType;

  const trigger: RoutineTrigger = { type };

  if (typeof raw.phrase === "string") trigger.phrase = raw.phrase;
  if (typeof raw.time === "string") trigger.time = raw.time;
  if (typeof raw.timezone === "string") trigger.timezone = raw.timezone;

  if (Array.isArray(raw.days)) {
    trigger.days = raw.days.filter((d): d is string => typeof d === "string");
  }

  return trigger;
}

/**
 * Normalize a raw action object from the export.
 */
function normalizeAction(raw: Record<string, unknown>): RoutineAction {
  const type = typeof raw.type === "string" ? raw.type : "custom_command";
  const action: RoutineAction = {
    type: VALID_ACTION_TYPES.has(type) ? (type as GoogleActionType) : type,
  };

  if (typeof raw.command === "string") action.command = raw.command;

  if (raw.params != null && typeof raw.params === "object" && !Array.isArray(raw.params)) {
    action.params = raw.params as Record<string, unknown>;
  }

  return action;
}

/**
 * Parse a raw routine object from the export JSON.
 */
function normalizeRoutine(raw: unknown, index: number): RoutineEntry | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const name = typeof obj.name === "string" ? obj.name : `Routine ${index + 1}`;

  const id = typeof obj.id === "string"
    ? obj.id
    : `ga-routine-${index}`;

  const trigger = obj.trigger != null && typeof obj.trigger === "object" && !Array.isArray(obj.trigger)
    ? normalizeTrigger(obj.trigger as Record<string, unknown>)
    : { type: "voice" as const };

  // Handle schedule at the routine level (alternative format)
  if (trigger.type === "voice" && obj.schedule != null && typeof obj.schedule === "object") {
    const sched = obj.schedule as Record<string, unknown>;
    if (typeof sched.time === "string") {
      trigger.type = "schedule";
      trigger.time = sched.time;
      if (typeof sched.timezone === "string") trigger.timezone = sched.timezone;
      if (Array.isArray(sched.days)) {
        trigger.days = sched.days.filter((d): d is string => typeof d === "string");
      }
    }
  }

  const actions = Array.isArray(obj.actions)
    ? obj.actions.map((a) =>
      a != null && typeof a === "object" && !Array.isArray(a)
        ? normalizeAction(a as Record<string, unknown>)
        : { type: "custom_command" as const, command: String(a) },
    )
    : [];

  if (actions.length === 0) return null;

  const enabled = typeof obj.enabled === "boolean" ? obj.enabled : true;

  return { id, name, trigger, actions, enabled };
}

/**
 * Parse a Google Takeout export for Google Assistant routines.
 *
 * Accepts either a ZIP file path or an extracted directory path.
 * Returns the parsed routines and the source path within the export.
 */
export async function parseGoogleAssistantExport(
  exportPath: string,
): Promise<GoogleAssistantParseResult> {
  const s = await stat(exportPath).catch(() => null);
  if (!s) {
    throw new MigrateError(
      `Export path not found: ${exportPath}`,
      "EXPORT_NOT_FOUND",
    );
  }

  let baseDir: string;
  let cleanup: (() => Promise<void>) | null = null;

  if (s.isFile() && exportPath.endsWith(".zip")) {
    baseDir = await extractZip(exportPath);
    cleanup = async () => {
      await rm(baseDir, { recursive: true, force: true }).catch(() => {});
    };
  } else if (s.isDirectory()) {
    baseDir = exportPath;
  } else {
    throw new MigrateError(
      "Export must be a .zip file or an extracted directory",
      "INVALID_EXPORT_FORMAT",
    );
  }

  try {
    const routineFile = await findRoutineFile(baseDir);
    if (!routineFile) {
      throw new MigrateError(
        "No routine definitions found in export. Expected routines.json in " +
        "Google Assistant/Routines/ or similar Takeout path.",
        "ROUTINES_NOT_FOUND",
      );
    }

    let raw: string;
    try {
      raw = await readFile(routineFile, "utf-8");
    } catch {
      throw new MigrateError(
        `Failed to read routine file: ${routineFile}`,
        "READ_FAILED",
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new MigrateError(
        "Routine file is not valid JSON",
        "INVALID_JSON",
      );
    }

    const rawRoutines = Array.isArray(parsed) ? parsed : [parsed];
    const routines: RoutineEntry[] = [];

    for (let i = 0; i < rawRoutines.length; i++) {
      const routine = normalizeRoutine(rawRoutines[i], i);
      if (routine) routines.push(routine);
    }

    // Derive the relative source path for display
    const sourcePath = routineFile.startsWith(baseDir)
      ? routineFile.slice(baseDir.length + 1)
      : routineFile;

    return { routines, sourcePath };
  } finally {
    if (cleanup) await cleanup();
  }
}

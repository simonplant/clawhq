/**
 * Google Assistant data export parser.
 *
 * Parses Google Takeout data for Assistant activity and routines.
 * Expects either:
 * - `My Activity/Assistant/MyActivity.json` (activity history)
 * - `Assistant/Routines/*.json` (routine definitions)
 *
 * No network calls — reads files from disk only.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import type {
  GoogleAssistantActivity,
  GoogleAssistantRoutine,
  ParsedMessage,
  ParsedRoutine,
  ParseResult,
} from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum individual file size (100 MB). */
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

/** Known activity JSON filenames in Google Takeout. */
const ACTIVITY_FILENAMES = [
  "MyActivity.json",
  "My Activity.json",
];

/** Known routine directory names. */
const ROUTINE_DIR_NAMES = [
  "Routines",
  "routines",
];

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a Google Assistant data export.
 *
 * Accepts the path to the Takeout directory (or a specific JSON file).
 * Scans for activity history and routine definitions.
 */
export async function parseGoogleAssistantExport(
  exportPath: string,
): Promise<ParseResult> {
  const pathStat = await stat(exportPath).catch(() => null);
  if (!pathStat) {
    return {
      success: false,
      source: "google-assistant",
      messages: [],
      routines: [],
      itemCount: 0,
      error: `Export path does not exist: ${exportPath}`,
    };
  }

  // If it's a file, parse it directly as activity JSON
  if (pathStat.isFile()) {
    return parseActivityFile(exportPath);
  }

  // If it's a directory, scan for known files
  if (pathStat.isDirectory()) {
    return parseExportDirectory(exportPath);
  }

  return {
    success: false,
    source: "google-assistant",
    messages: [],
    routines: [],
    itemCount: 0,
    error: "Export path is neither a file nor a directory",
  };
}

// ── Directory Scanner ────────────────────────────────────────────────────────

/** Scan a Takeout directory for activity and routine files. */
async function parseExportDirectory(dirPath: string): Promise<ParseResult> {
  const allMessages: ParsedMessage[] = [];
  const allRoutines: ParsedRoutine[] = [];
  let totalItems = 0;

  // Search for activity files (recursive, max 3 levels deep)
  const activityFiles = await findFiles(dirPath, ACTIVITY_FILENAMES, 3);
  for (const filePath of activityFiles) {
    const result = await parseActivityFile(filePath);
    if (result.success) {
      allMessages.push(...result.messages);
      allRoutines.push(...result.routines);
      totalItems += result.itemCount;
    }
  }

  // Search for routine directories and parse routine files
  const routineFiles = await findRoutineFiles(dirPath, 3);
  for (const filePath of routineFiles) {
    const routines = await parseRoutineFile(filePath);
    allRoutines.push(...routines);
  }

  if (allMessages.length === 0 && allRoutines.length === 0) {
    return {
      success: false,
      source: "google-assistant",
      messages: [],
      routines: [],
      itemCount: 0,
      error: "No Google Assistant activity or routines found in export directory",
    };
  }

  return {
    success: true,
    source: "google-assistant",
    messages: allMessages,
    routines: allRoutines,
    itemCount: totalItems,
  };
}

// ── Activity Parser ──────────────────────────────────────────────────────────

/** Parse a single Google Assistant activity JSON file. */
async function parseActivityFile(filePath: string): Promise<ParseResult> {
  let raw: string;
  try {
    raw = await readFile(filePath, { encoding: "utf-8" });
  } catch {
    return {
      success: false,
      source: "google-assistant",
      messages: [],
      routines: [],
      itemCount: 0,
      error: "Cannot read file",
    };
  }

  if (Buffer.byteLength(raw, "utf-8") > MAX_FILE_SIZE_BYTES) {
    return {
      success: false,
      source: "google-assistant",
      messages: [],
      routines: [],
      itemCount: 0,
      error: `File exceeds ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB limit`,
    };
  }

  let activities: GoogleAssistantActivity[];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return {
        success: false,
        source: "google-assistant",
        messages: [],
        routines: [],
        itemCount: 0,
        error: "Expected activity file to contain a JSON array",
      };
    }
    activities = parsed as GoogleAssistantActivity[];
  } catch {
    return {
      success: false,
      source: "google-assistant",
      messages: [],
      routines: [],
      itemCount: 0,
      error: "Invalid JSON in activity file",
    };
  }

  const messages: ParsedMessage[] = [];
  const routines: ParsedRoutine[] = [];

  for (const activity of activities) {
    // Extract the user's query from the title (Google format: "Said \"...\""  or direct text)
    const text = extractQueryFromTitle(activity.title);
    if (!text) continue;

    const timestamp = activity.time || undefined;

    messages.push({
      text,
      timestamp,
      source: "google-assistant",
    });

    // Detect routine-like patterns
    if (isRoutineLike(activity)) {
      routines.push({
        name: activity.title,
        schedule: inferScheduleFromActivity(activity),
        description: text.slice(0, 200),
        source: "google-assistant",
      });
    }
  }

  return {
    success: true,
    source: "google-assistant",
    messages,
    routines,
    itemCount: activities.length,
  };
}

// ── Routine Parser ───────────────────────────────────────────────────────────

/** Parse a Google Assistant routine definition file. */
async function parseRoutineFile(filePath: string): Promise<ParsedRoutine[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, { encoding: "utf-8" });
  } catch {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    // Handle single routine object or array
    const routines: GoogleAssistantRoutine[] = Array.isArray(parsed)
      ? (parsed as GoogleAssistantRoutine[])
      : [parsed as GoogleAssistantRoutine];

    return routines
      .filter((r) => r.name && r.trigger)
      .map((r) => ({
        name: r.name,
        schedule: r.trigger,
        description: r.actions
          ?.map((a) => a.command || a.type)
          .filter(Boolean)
          .join(", ") ?? r.name,
        source: "google-assistant" as const,
      }));
  } catch {
    return [];
  }
}

// ── File Finders ─────────────────────────────────────────────────────────────

/** Recursively find files matching target names, limited by depth. */
async function findFiles(
  dir: string,
  targetNames: readonly string[],
  maxDepth: number,
): Promise<string[]> {
  if (maxDepth <= 0) return [];

  const results: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const entryStat = await stat(fullPath).catch(() => null);
    if (!entryStat) continue;

    if (entryStat.isFile() && targetNames.includes(entry)) {
      results.push(fullPath);
    } else if (entryStat.isDirectory()) {
      const sub = await findFiles(fullPath, targetNames, maxDepth - 1);
      results.push(...sub);
    }
  }

  return results;
}

/** Find JSON files inside routine directories. */
async function findRoutineFiles(
  dir: string,
  maxDepth: number,
): Promise<string[]> {
  if (maxDepth <= 0) return [];

  const results: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const entryStat = await stat(fullPath).catch(() => null);
    if (!entryStat) continue;

    if (entryStat.isDirectory()) {
      if (ROUTINE_DIR_NAMES.includes(entry)) {
        // This is a routines directory — grab all JSON files
        const routineEntries = await readdir(fullPath).catch(() => {
          return [] as string[];
        });
        for (const re of routineEntries) {
          if (re.endsWith(".json")) {
            results.push(join(fullPath, re));
          }
        }
      } else {
        // Keep searching deeper
        const sub = await findRoutineFiles(fullPath, maxDepth - 1);
        results.push(...sub);
      }
    }
  }

  return results;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Extract the user's spoken query from a Google activity title. */
function extractQueryFromTitle(title: string): string | null {
  if (!title) return null;

  // Google uses "Said \"...\""  or "Asked \"...\""
  const quotedMatch = title.match(/(?:Said|Asked)\s+"([^"]+)"/i);
  if (quotedMatch && quotedMatch[1]) return quotedMatch[1];

  // Or plain text activity (e.g., "Set a timer for 5 minutes")
  if (title.startsWith("Used ") || title.startsWith("Visited ")) return null;

  return title;
}

/** Check if an activity looks like a routine/recurring command. */
function isRoutineLike(activity: GoogleAssistantActivity): boolean {
  const lower = activity.title.toLowerCase();
  const routineHints = [
    "routine",
    "alarm",
    "reminder",
    "timer",
    "schedule",
    "set a ",
    "wake me",
    "remind me",
  ];
  return routineHints.some((hint) => lower.includes(hint));
}

/** Infer a schedule from a Google activity. */
function inferScheduleFromActivity(
  activity: GoogleAssistantActivity,
): string {
  const lower = activity.title.toLowerCase();

  // Look for time patterns
  const timeMatch = lower.match(
    /(?:at|for)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i,
  );
  if (timeMatch) {
    const hour = parseInt(timeMatch[1] ?? "0", 10);
    const minute = timeMatch[2] ?? "00";
    const period = timeMatch[3]?.replace(/\./g, "").toLowerCase();
    const h24 =
      period === "pm" && hour < 12
        ? hour + 12
        : period === "am" && hour === 12
          ? 0
          : hour;
    return `${h24}:${minute}`;
  }

  if (lower.includes("morning")) return "morning";
  if (lower.includes("evening") || lower.includes("night")) return "evening";

  return "daily";
}

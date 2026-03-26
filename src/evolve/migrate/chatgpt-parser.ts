/**
 * ChatGPT data export parser.
 *
 * Parses the `conversations.json` file from a ChatGPT data export
 * (Settings → Data controls → Export data). Extracts user messages
 * and detects recurring patterns that could become cron jobs.
 *
 * No network calls — reads files from disk only.
 */

import { readFile } from "node:fs/promises";

import type {
  ChatGPTConversation,
  ChatGPTNode,
  ParsedMessage,
  ParsedRoutine,
  ParseResult,
} from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum file size we'll attempt to parse (500 MB). */
const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024;

/**
 * Keywords that suggest a message describes a recurring routine.
 * Used for heuristic routine detection when no explicit routines exist.
 */
const ROUTINE_KEYWORDS = [
  "every day",
  "every morning",
  "every evening",
  "every week",
  "daily",
  "weekly",
  "monthly",
  "remind me",
  "schedule",
  "routine",
  "recurring",
  "alarm",
  "wake me",
  "at 7",
  "at 8",
  "at 9",
  "each morning",
  "each evening",
  "each day",
];

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a ChatGPT data export file.
 *
 * Expects the path to `conversations.json` from the export zip.
 * Extracts user messages and detects routines from conversation patterns.
 */
export async function parseChatGPTExport(
  exportPath: string,
): Promise<ParseResult> {
  let raw: string;
  try {
    raw = await readFile(exportPath, { encoding: "utf-8" });
  } catch (err) {
    return {
      success: false,
      source: "chatgpt",
      messages: [],
      routines: [],
      itemCount: 0,
      error: `Cannot read export file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (Buffer.byteLength(raw, "utf-8") > MAX_FILE_SIZE_BYTES) {
    return {
      success: false,
      source: "chatgpt",
      messages: [],
      routines: [],
      itemCount: 0,
      error: `Export file exceeds ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB limit`,
    };
  }

  let conversations: ChatGPTConversation[];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return {
        success: false,
        source: "chatgpt",
        messages: [],
        routines: [],
        itemCount: 0,
        error: "Expected conversations.json to contain a JSON array",
      };
    }
    conversations = parsed as ChatGPTConversation[];
  } catch (err) {
    return {
      success: false,
      source: "chatgpt",
      messages: [],
      routines: [],
      itemCount: 0,
      error: "Invalid JSON in export file",
    };
  }

  const messages: ParsedMessage[] = [];
  const routines: ParsedRoutine[] = [];

  for (const conversation of conversations) {
    if (!conversation.mapping) continue;

    const userMessages = extractUserMessages(conversation);
    messages.push(...userMessages);

    // Detect routines from user messages
    const detected = detectRoutines(userMessages, conversation.title);
    routines.push(...detected);
  }

  return {
    success: true,
    source: "chatgpt",
    messages,
    routines: deduplicateRoutines(routines),
    itemCount: conversations.length,
  };
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

/** Extract all user messages from a conversation's node tree. */
function extractUserMessages(
  conversation: ChatGPTConversation,
): ParsedMessage[] {
  const result: ParsedMessage[] = [];

  for (const node of Object.values(conversation.mapping) as ChatGPTNode[]) {
    if (!node.message) continue;
    if (node.message.author.role !== "user") continue;

    const parts = node.message.content.parts;
    if (!parts || parts.length === 0) continue;

    const text = parts.filter((p) => typeof p === "string").join("\n").trim();
    if (!text) continue;

    const timestamp = node.message.create_time
      ? new Date(node.message.create_time * 1000).toISOString()
      : undefined;

    result.push({ text, timestamp, source: "chatgpt" });
  }

  return result;
}

/** Detect recurring routines from user messages using keyword heuristics. */
function detectRoutines(
  messages: readonly ParsedMessage[],
  conversationTitle: string,
): ParsedRoutine[] {
  const routines: ParsedRoutine[] = [];

  for (const msg of messages) {
    const lower = msg.text.toLowerCase();
    const matchedKeyword = ROUTINE_KEYWORDS.find((kw) => lower.includes(kw));

    if (matchedKeyword) {
      routines.push({
        name: conversationTitle || "Imported routine",
        schedule: extractScheduleHint(lower, matchedKeyword),
        description: msg.text.slice(0, 200),
        source: "chatgpt",
      });
    }
  }

  return routines;
}

/** Extract a schedule hint from the message text near the keyword. */
function extractScheduleHint(text: string, keyword: string): string {
  // Try to find a time near the keyword
  const idx = text.indexOf(keyword);
  const window = text.slice(Math.max(0, idx - 20), idx + keyword.length + 40);

  // Look for time patterns like "at 7am", "at 8:00", "7 am"
  const timeMatch = window.match(
    /(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
  );
  if (timeMatch) {
    const hour = parseInt(timeMatch[1] ?? "0", 10);
    const minute = timeMatch[2] ?? "00";
    const period = timeMatch[3]?.toLowerCase();
    const h24 =
      period === "pm" && hour < 12
        ? hour + 12
        : period === "am" && hour === 12
          ? 0
          : hour;
    return `${h24}:${minute}`;
  }

  // Map keywords to general schedule descriptions
  if (keyword.includes("morning") || keyword.includes("wake")) return "morning";
  if (keyword.includes("evening")) return "evening";
  if (keyword.includes("weekly") || keyword.includes("every week"))
    return "weekly";
  if (keyword.includes("monthly")) return "monthly";
  return "daily";
}

/** Remove duplicate routines by name + schedule. */
function deduplicateRoutines(
  routines: readonly ParsedRoutine[],
): ParsedRoutine[] {
  const seen = new Set<string>();
  const result: ParsedRoutine[] = [];

  for (const r of routines) {
    const key = `${r.name}::${r.schedule}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(r);
    }
  }

  return result;
}

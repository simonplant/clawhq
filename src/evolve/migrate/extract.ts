/**
 * Preference extraction via local Ollama.
 *
 * Analyzes user messages from ChatGPT/Google Assistant exports to
 * extract communication style, scheduling preferences, interests,
 * and behavioral patterns. All inference runs locally — no data
 * leaves the machine.
 *
 * Falls back gracefully if Ollama is unavailable — returns empty
 * preferences with a warning instead of failing.
 */

import {
  generate,
  isOllamaAvailable,
  OllamaError,
} from "../../design/configure/ollama.js";

import type {
  ExtractedPreference,
  ExtractionResult,
  ParsedMessage,
} from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Max messages to include in the extraction prompt (context window limits). */
const MAX_MESSAGES_FOR_EXTRACTION = 100;

/** Max characters per message included in the prompt. */
const MAX_MESSAGE_LENGTH = 500;

// ── Prompt Template ──────────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are analyzing a user's conversation history from an AI assistant to extract their preferences and patterns.

Given the following user messages, extract preferences in these categories:
- communication: How they prefer to communicate (formal/casual, brief/detailed, etc.)
- scheduling: When they're active, preferred times, frequency of interactions
- interests: Topics they frequently discuss or ask about
- work: Work-related patterns and preferences
- lifestyle: Daily routines, habits, personal preferences

Return ONLY a JSON array of objects with these fields:
- category: one of the categories above
- preference: a clear, concise description of the preference
- confidence: "high" (many supporting messages), "medium" (some evidence), "low" (inferred)

Example output:
[
  {"category": "communication", "preference": "Prefers concise, bullet-point responses", "confidence": "high"},
  {"category": "scheduling", "preference": "Most active between 8am-10am and 7pm-9pm", "confidence": "medium"}
]

Return ONLY the JSON array, no other text.

User messages:
{MESSAGES}`;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract user preferences from parsed messages using local Ollama.
 *
 * Samples messages, builds a prompt, and asks Ollama to identify patterns.
 * Returns empty preferences if Ollama is unavailable (no failure).
 */
export async function extractPreferences(
  messages: readonly ParsedMessage[],
  options: {
    readonly ollamaUrl?: string;
    readonly ollamaModel?: string;
  } = {},
): Promise<ExtractionResult> {
  const ollamaUrl = options.ollamaUrl ?? "http://127.0.0.1:11434";
  const model = options.ollamaModel ?? "llama3:8b";

  if (messages.length === 0) {
    return {
      success: true,
      preferences: [],
      ollamaUsed: false,
    };
  }

  // Check Ollama availability
  const available = await isOllamaAvailable(ollamaUrl);
  if (!available) {
    return {
      success: false,
      preferences: [],
      ollamaUsed: false,
      error: "Ollama not available. Preferences cannot be extracted without local AI. Start Ollama with: ollama serve",
    };
  }

  // Sample and format messages for the prompt
  const sampled = sampleMessages(messages);
  const formatted = sampled
    .map((m) => `- ${m.text.slice(0, MAX_MESSAGE_LENGTH)}`)
    .join("\n");

  const prompt = EXTRACTION_PROMPT.replace("{MESSAGES}", formatted);

  try {
    const response = await generate(prompt, {
      baseUrl: ollamaUrl,
      model,
    });

    const preferences = parsePreferencesResponse(response);

    return {
      success: true,
      preferences,
      ollamaUsed: true,
    };
  } catch (err) {
    const message =
      err instanceof OllamaError
        ? err.message
        : "Preference extraction failed unexpectedly";

    return {
      success: false,
      preferences: [],
      ollamaUsed: true,
      error: message,
    };
  }
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Sample messages for extraction. Takes a representative spread across
 * the conversation history rather than just the most recent.
 */
function sampleMessages(
  messages: readonly ParsedMessage[],
): readonly ParsedMessage[] {
  if (messages.length <= MAX_MESSAGES_FOR_EXTRACTION) {
    return messages;
  }

  // Take evenly spaced samples across the full history
  const step = messages.length / MAX_MESSAGES_FOR_EXTRACTION;
  const sampled: ParsedMessage[] = [];
  for (let i = 0; i < MAX_MESSAGES_FOR_EXTRACTION; i++) {
    const idx = Math.min(Math.floor(i * step), messages.length - 1);
    const msg = messages[idx];
    if (msg) sampled.push(msg);
  }

  return sampled;
}

/** Parse the Ollama response into structured preferences. */
function parsePreferencesResponse(
  response: string,
): ExtractedPreference[] {
  // Extract JSON array from the response (may have surrounding text)
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return (parsed as Record<string, unknown>[])
      .filter(
        (item) =>
          typeof item.category === "string" &&
          typeof item.preference === "string" &&
          typeof item.confidence === "string",
      )
      .map((item) => ({
        category: String(item.category),
        preference: String(item.preference),
        confidence: normalizeConfidence(String(item.confidence)),
      }));
  } catch (err) {
    console.warn("[evolve] Failed to parse LLM preference output:", err);
    return [];
  }
}

/** Normalize confidence values to the expected enum. */
function normalizeConfidence(
  value: string,
): "high" | "medium" | "low" {
  const lower = value.toLowerCase();
  if (lower === "high") return "high";
  if (lower === "low") return "low";
  return "medium";
}

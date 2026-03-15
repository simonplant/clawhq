/**
 * Fact and preference extractor for ChatGPT conversation history.
 *
 * Uses local LLM (Ollama) as the primary extraction method.
 * Falls back to pattern-based extraction when Ollama is unavailable.
 */

import { OllamaClient } from "../../inference/ollama.js";

import type { ExtractedItem } from "./types.js";

/** Approximate bytes per token for budget tracking. */
const BYTES_PER_TOKEN = 4;

/** Maximum text length to send per LLM call (avoid context overflow). */
const MAX_CHUNK_CHARS = 8000;

/** Generate a unique extraction ID. */
function generateId(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `mig-${ts}-${rand}`;
}

// --- LLM-based extraction ---

const EXTRACTION_PROMPT = `You are analyzing a user's ChatGPT conversation history to extract personal facts, preferences, habits, and relationships. Extract ONLY information about the USER (not the assistant).

For each extracted item, output a JSON array of objects with these fields:
- "content": a concise statement about the user (e.g., "Prefers bullet-point summaries over paragraphs")
- "category": one of "preference", "fact", "relationship", "habit"
- "confidence": "high" if explicitly stated, "medium" if strongly implied, "low" if inferred

Rules:
- Focus on recurring patterns and explicit statements
- Ignore one-off questions or hypothetical scenarios
- Do NOT extract information about coding tasks, debugging sessions, or technical Q&A unless it reveals a personal preference
- Keep each item to one clear sentence
- Output ONLY the JSON array, no other text

Example output:
[
  {"content": "Prefers morning meetings over afternoon ones", "category": "preference", "confidence": "high"},
  {"content": "Works in the finance industry", "category": "fact", "confidence": "medium"}
]`;

/**
 * Parse JSON from LLM response, handling markdown code fences.
 */
function parseLLMResponse(response: string): Array<{
  content: string;
  category: string;
  confidence: string;
}> {
  // Strip markdown code fences if present
  let cleaned = response.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is { content: string; category: string; confidence: string } =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).content === "string" &&
        typeof (item as Record<string, unknown>).category === "string",
    );
  } catch {
    return [];
  }
}

/**
 * Extract facts/preferences using local LLM (Ollama).
 */
export async function extractWithLLM(
  texts: { title: string; text: string }[],
  ollamaHost: string,
  ollamaModel: string,
): Promise<ExtractedItem[]> {
  const client = new OllamaClient(ollamaHost, ollamaModel);
  const items: ExtractedItem[] = [];

  // Chunk texts to stay within context limits
  const chunks: { titles: string[]; text: string }[] = [];
  let currentChunk = { titles: [] as string[], text: "" };

  for (const { title, text } of texts) {
    if (currentChunk.text.length + text.length > MAX_CHUNK_CHARS && currentChunk.text.length > 0) {
      chunks.push(currentChunk);
      currentChunk = { titles: [], text: "" };
    }
    currentChunk.titles.push(title);
    currentChunk.text += `\n--- Conversation: ${title} ---\n${text}\n`;
  }
  if (currentChunk.text.length > 0) {
    chunks.push(currentChunk);
  }

  for (const chunk of chunks) {
    const response = await client.chat([
      { role: "system", content: EXTRACTION_PROMPT },
      { role: "user", content: chunk.text },
    ]);

    const parsed = parseLLMResponse(response);
    for (const raw of parsed) {
      const category = validateCategory(raw.category);
      const confidence = validateConfidence(raw.confidence);
      items.push({
        id: generateId(),
        content: raw.content,
        category,
        confidence,
        sources: chunk.titles,
        piiMasked: false,
      });
    }
  }

  return deduplicateItems(items);
}

// --- Pattern-based fallback extraction ---

const PREFERENCE_PATTERNS = [
  /(?:i\s+(?:always|usually|prefer|like|want|love|hate|dislike|avoid))\s+(.+?)(?:\.|$)/gi,
  /(?:please\s+(?:always|never|don't))\s+(.+?)(?:\.|$)/gi,
  /(?:i'd\s+rather|make\s+sure\s+to)\s+(.+?)(?:\.|$)/gi,
];

const FACT_PATTERNS = [
  /(?:i\s+(?:am|work|live|have|use|run|own|manage))\s+(.+?)(?:\.|$)/gi,
  /(?:my\s+(?:name|job|role|title|company|team|department))\s+(?:is|are)\s+(.+?)(?:\.|$)/gi,
];

const RELATIONSHIP_PATTERNS = [
  /(?:my\s+(?:colleague|boss|manager|wife|husband|partner|friend|client|team))\s+(\w+(?:\s+\w+)?)/gi,
  /(\w+(?:\s+\w+)?)\s+(?:is\s+my|works\s+(?:with|for))\s+(.+?)(?:\.|$)/gi,
];

const HABIT_PATTERNS = [
  /(?:every\s+(?:morning|evening|day|week|month))\s+(?:i)\s+(.+?)(?:\.|$)/gi,
  /(?:i\s+(?:usually|typically|normally|always))\s+(.+?)(?:\s+(?:every|each|in the))/gi,
];

function extractByPatterns(
  text: string,
  patterns: RegExp[],
): string[] {
  const results: string[] = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const content = (m[1] ?? m[0]).trim();
      if (content.length > 5 && content.length < 300) {
        results.push(content);
      }
    }
  }
  return results;
}

/**
 * Extract facts/preferences using pattern matching (fallback when LLM unavailable).
 */
export function extractWithPatterns(
  texts: { title: string; text: string }[],
): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  const seen = new Set<string>();

  for (const { title, text } of texts) {
    const lowerText = text.toLowerCase();

    for (const match of extractByPatterns(text, PREFERENCE_PATTERNS)) {
      const key = match.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        items.push({
          id: generateId(),
          content: `Prefers: ${match}`,
          category: "preference",
          confidence: "medium",
          sources: [title],
          piiMasked: false,
        });
      }
    }

    for (const match of extractByPatterns(text, FACT_PATTERNS)) {
      const key = match.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        items.push({
          id: generateId(),
          content: match,
          category: "fact",
          confidence: "medium",
          sources: [title],
          piiMasked: false,
        });
      }
    }

    for (const match of extractByPatterns(lowerText, RELATIONSHIP_PATTERNS)) {
      const key = match.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        items.push({
          id: generateId(),
          content: match,
          category: "relationship",
          confidence: "low",
          sources: [title],
          piiMasked: false,
        });
      }
    }

    for (const match of extractByPatterns(text, HABIT_PATTERNS)) {
      const key = match.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        items.push({
          id: generateId(),
          content: match,
          category: "habit",
          confidence: "medium",
          sources: [title],
          piiMasked: false,
        });
      }
    }
  }

  return items;
}

/**
 * Extract facts and preferences, trying LLM first with pattern fallback.
 */
export async function extract(
  texts: { title: string; text: string }[],
  ollamaHost: string,
  ollamaModel: string,
): Promise<{ items: ExtractedItem[]; method: "llm" | "patterns" }> {
  if (texts.length === 0) {
    return { items: [], method: "patterns" };
  }

  const client = new OllamaClient(ollamaHost, ollamaModel);
  const available = await client.isAvailable();

  if (available) {
    try {
      const items = await extractWithLLM(texts, ollamaHost, ollamaModel);
      return { items, method: "llm" };
    } catch {
      // Fall through to pattern extraction
    }
  }

  const items = extractWithPatterns(texts);
  return { items, method: "patterns" };
}

// --- Helpers ---

function validateCategory(raw: string): ExtractedItem["category"] {
  const valid = ["preference", "fact", "relationship", "habit"] as const;
  return valid.includes(raw as ExtractedItem["category"])
    ? (raw as ExtractedItem["category"])
    : "fact";
}

function validateConfidence(raw: string): ExtractedItem["confidence"] {
  const valid = ["high", "medium", "low"] as const;
  return valid.includes(raw as ExtractedItem["confidence"])
    ? (raw as ExtractedItem["confidence"])
    : "medium";
}

/** Remove near-duplicate items by normalized content. */
function deduplicateItems(items: ExtractedItem[]): ExtractedItem[] {
  const seen = new Set<string>();
  const result: ExtractedItem[] = [];

  for (const item of items) {
    const key = item.content.toLowerCase().replace(/\s+/g, " ").trim();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result;
}

/**
 * Estimate token count for extracted items.
 */
export function estimateTokens(items: ExtractedItem[]): number {
  return items.reduce(
    (sum, item) => sum + Math.ceil(item.content.length / BYTES_PER_TOKEN),
    0,
  );
}

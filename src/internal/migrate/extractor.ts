/**
 * Fact and preference extractor for ChatGPT conversation history.
 *
 * Uses regex-based pattern matching to extract facts, preferences,
 * habits, and relationships from user messages. No LLM dependency.
 */

import type { ExtractedItem } from "./types.js";

/** Approximate bytes per token for budget tracking. */
const BYTES_PER_TOKEN = 4;

/** Generate a unique extraction ID. */
function generateId(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `mig-${ts}-${rand}`;
}

// --- Pattern-based extraction ---

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
 * Extract facts/preferences using regex pattern matching.
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
 * Extract facts and preferences using regex-based pattern matching.
 */
export function extract(
  texts: { title: string; text: string }[],
): { items: ExtractedItem[]; method: "patterns" } {
  if (texts.length === 0) {
    return { items: [], method: "patterns" };
  }

  const items = extractWithPatterns(texts);
  return { items, method: "patterns" };
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

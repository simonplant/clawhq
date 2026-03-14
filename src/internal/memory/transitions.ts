/**
 * Tier transitions — move entries between hot/warm/cold tiers.
 *
 * Hot -> warm: summarize while preserving key information.
 * Warm -> cold: further compress and mask PII.
 * Cold -> delete: per policy.
 *
 * Summarization is designed to use local models by default.
 * The summarizer is injected as a function so callers can provide
 * Ollama-backed or fallback implementations.
 */

import { deleteEntry, findTransitionCandidates, writeEntry } from "./store.js";
import type { StructuredMemoryEntry, TierPolicy, TransitionResult } from "./types.js";
import { DEFAULT_TIER_POLICY } from "./types.js";

// --- PII masking ---

/** Common PII patterns for masking during warm -> cold transition. */
const PII_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  { pattern: /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g, replacement: "[NAME]" },
  { pattern: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, replacement: "[EMAIL]" },
  { pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, replacement: "[PHONE]" },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: "[SSN]" },
  { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, replacement: "[CARD]" },
];

/**
 * Mask PII in a text string.
 */
export function maskPII(text: string): string {
  let result = text;
  for (const { pattern, replacement } of PII_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// --- Summarization ---

/**
 * A summarizer function that compresses text.
 * Designed to be backed by a local model (Ollama) in production.
 */
export type Summarizer = (text: string) => Promise<string>;

/**
 * Default fallback summarizer: truncates to first sentence + key phrases.
 * Used when no local model is available.
 */
export function fallbackSummarize(text: string): string {
  // Take the first sentence or first 200 chars
  const sentenceEnd = text.search(/[.!?]\s/);
  if (sentenceEnd > 0 && sentenceEnd < 200) {
    return text.slice(0, sentenceEnd + 1);
  }
  if (text.length <= 200) return text;
  return text.slice(0, 197) + "...";
}

// --- Transition operations ---

/**
 * Run hot -> warm transitions.
 *
 * Entries that exceed age or size thresholds are summarized and moved
 * to the warm tier.
 */
export async function transitionHotToWarm(
  openclawHome: string,
  options: {
    policy?: TierPolicy;
    summarizer?: Summarizer;
  } = {},
): Promise<TransitionResult> {
  const policy = options.policy ?? DEFAULT_TIER_POLICY;
  const summarize = options.summarizer ?? ((t: string) => Promise.resolve(fallbackSummarize(t)));

  const candidates = await findTransitionCandidates(openclawHome, "hot", policy);
  let moved = 0;
  let summarized = 0;

  for (const entry of candidates) {
    const summarizedContent = await summarize(entry.content);
    const warmEntry: StructuredMemoryEntry = {
      ...entry,
      content: summarizedContent,
      lastAccessedAt: new Date().toISOString(),
    };

    await writeEntry(openclawHome, "warm", warmEntry);
    await deleteEntry(openclawHome, "hot", entry.id);
    moved++;
    if (summarizedContent !== entry.content) {
      summarized++;
    }
  }

  return { moved, deleted: 0, summarized, piiMasked: 0 };
}

/**
 * Run warm -> cold transitions.
 *
 * Entries that exceed the warm age threshold are further compressed,
 * PII-masked, and moved to the cold tier.
 */
export async function transitionWarmToCold(
  openclawHome: string,
  options: {
    policy?: TierPolicy;
    summarizer?: Summarizer;
  } = {},
): Promise<TransitionResult> {
  const policy = options.policy ?? DEFAULT_TIER_POLICY;
  const summarize = options.summarizer ?? ((t: string) => Promise.resolve(fallbackSummarize(t)));

  const candidates = await findTransitionCandidates(openclawHome, "warm", policy);
  let moved = 0;
  let summarized = 0;
  let piiMasked = 0;

  for (const entry of candidates) {
    const summarizedContent = await summarize(entry.content);
    const maskedContent = maskPII(summarizedContent);

    const coldEntry: StructuredMemoryEntry = {
      ...entry,
      content: maskedContent,
      lastAccessedAt: new Date().toISOString(),
    };

    await writeEntry(openclawHome, "cold", coldEntry);
    await deleteEntry(openclawHome, "warm", entry.id);
    moved++;
    if (summarizedContent !== entry.content) summarized++;
    if (maskedContent !== summarizedContent) piiMasked++;
  }

  return { moved, deleted: 0, summarized, piiMasked };
}

/**
 * Run cold tier cleanup (delete entries beyond max age per policy).
 */
export async function cleanupCold(
  openclawHome: string,
  policy: TierPolicy = DEFAULT_TIER_POLICY,
): Promise<TransitionResult> {
  if (!policy.deleteColdBeyondMax) {
    return { moved: 0, deleted: 0, summarized: 0, piiMasked: 0 };
  }

  const candidates = await findTransitionCandidates(openclawHome, "cold", policy);
  let deleted = 0;

  for (const entry of candidates) {
    if (await deleteEntry(openclawHome, "cold", entry.id)) {
      deleted++;
    }
  }

  return { moved: 0, deleted, summarized: 0, piiMasked: 0 };
}

/**
 * Run all tier transitions in sequence.
 */
export async function runAllTransitions(
  openclawHome: string,
  options: {
    policy?: TierPolicy;
    summarizer?: Summarizer;
  } = {},
): Promise<TransitionResult> {
  const policy = options.policy ?? DEFAULT_TIER_POLICY;

  const hotToWarm = await transitionHotToWarm(openclawHome, options);
  const warmToCold = await transitionWarmToCold(openclawHome, options);
  const coldCleanup = await cleanupCold(openclawHome, policy);

  return {
    moved: hotToWarm.moved + warmToCold.moved,
    deleted: coldCleanup.deleted,
    summarized: hotToWarm.summarized + warmToCold.summarized,
    piiMasked: warmToCold.piiMasked,
  };
}

/**
 * Memory search — keyword search across warm/cold tiers.
 *
 * v1 uses simple text matching (case-insensitive substring / word match).
 * qdrant vector search is a future upgrade (FEAT-090 dependency).
 */

import { listEntries } from "./store.js";
import type { MemoryTierName, StructuredMemoryEntry } from "./types.js";

/** A search result with relevance scoring and tier origin. */
export interface MemorySearchResult {
  entry: StructuredMemoryEntry;
  tier: MemoryTierName;
  /** Higher is more relevant. Exact phrase > word match. */
  score: number;
}

export interface MemorySearchOptions {
  /** ISO date string — only return entries created on or after this date. */
  since?: string;
  /** Restrict search to specific tiers. Defaults to warm + cold. */
  tiers?: MemoryTierName[];
}

const DEFAULT_TIERS: MemoryTierName[] = ["warm", "cold"];

/**
 * Score how well an entry matches the query.
 *
 * Scoring:
 *  - Exact phrase in content: +10
 *  - Exact phrase in tags:    +8
 *  - Each word match in content: +2
 *  - Each word match in tags:    +1
 *  - 0 means no match
 */
function scoreEntry(entry: StructuredMemoryEntry, queryLower: string, queryWords: string[]): number {
  const contentLower = entry.content.toLowerCase();
  const tagsLower = entry.tags.map((t) => t.toLowerCase()).join(" ");

  let score = 0;

  // Exact phrase matches
  if (contentLower.includes(queryLower)) score += 10;
  if (tagsLower.includes(queryLower)) score += 8;

  // Word-level matches
  for (const word of queryWords) {
    if (contentLower.includes(word)) score += 2;
    if (tagsLower.includes(word)) score += 1;
  }

  return score;
}

/**
 * Search across memory tiers for entries matching a keyword query.
 *
 * Returns results sorted by relevance (highest first).
 */
export async function searchMemory(
  openclawHome: string,
  query: string,
  options: MemorySearchOptions = {},
): Promise<MemorySearchResult[]> {
  const tiers = options.tiers ?? DEFAULT_TIERS;
  const queryLower = query.toLowerCase().trim();

  if (queryLower.length === 0) return [];

  const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 0);
  const sinceMs = options.since ? new Date(options.since).getTime() : null;

  const results: MemorySearchResult[] = [];

  for (const tier of tiers) {
    const entries = await listEntries(openclawHome, tier);

    for (const entry of entries) {
      // Date filter
      if (sinceMs != null && new Date(entry.createdAt).getTime() < sinceMs) {
        continue;
      }

      const score = scoreEntry(entry, queryLower, queryWords);
      if (score > 0) {
        results.push({ entry, tier, score });
      }
    }
  }

  // Sort by score descending, then by createdAt descending (newest first)
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(b.entry.createdAt).getTime() - new Date(a.entry.createdAt).getTime();
  });

  return results;
}

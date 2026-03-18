/**
 * Background reflection — analyze existing memories for new connections.
 *
 * During idle time, scans across memory entries to find relationships
 * and patterns that weren't obvious when entries were ingested individually.
 * Proposes new connections for user review.
 */

import { listEntries } from "./store.js";
import type {
  Confidence,
  ProposedConnection,
  ReflectionResult,
  StructuredMemoryEntry,
} from "./types.js";

/**
 * Calculate tag overlap between two entries.
 * Returns a score 0-1 representing how related the entries are.
 */
function tagOverlap(a: StructuredMemoryEntry, b: StructuredMemoryEntry): number {
  if (a.tags.length === 0 || b.tags.length === 0) return 0;
  const setA = new Set(a.tags);
  const shared = b.tags.filter((t) => setA.has(t));
  const union = new Set([...a.tags, ...b.tags]);
  return shared.length / union.size;
}

/**
 * Check if two entries share entity references (for relationship entries).
 */
function hasSharedEntities(a: StructuredMemoryEntry, b: StructuredMemoryEntry): boolean {
  if (a.category !== "relationships" || b.category !== "relationships") return false;
  const entitiesA = new Set(a.entities.map((e) => e.toLowerCase()));
  return b.entities.some((e) => entitiesA.has(e.toLowerCase()));
}

/**
 * Check if two entries are in the same domain (for domain expertise entries).
 */
function sameDomain(a: StructuredMemoryEntry, b: StructuredMemoryEntry): boolean {
  if (a.category !== "domain_expertise" || b.category !== "domain_expertise") return false;
  return a.domain.toLowerCase() === b.domain.toLowerCase();
}

/**
 * Determine confidence level based on connection strength.
 */
function scoreToConfidence(score: number): Confidence {
  if (score >= 0.6) return "high";
  if (score >= 0.3) return "medium";
  return "low";
}

/** Minimum overlap score to propose a connection. */
const MIN_CONNECTION_SCORE = 0.25;

/**
 * Run background reflection across all memory tiers.
 *
 * Analyzes entries for tag overlap, shared entities, and domain proximity
 * to discover previously undetected connections.
 */
export async function reflect(openclawHome: string): Promise<ReflectionResult> {
  // Collect entries from all tiers
  const hot = await listEntries(openclawHome, "hot");
  const warm = await listEntries(openclawHome, "warm");
  const allEntries = [...hot, ...warm]; // Skip cold — too compressed for meaningful reflection

  const connections: ProposedConnection[] = [];
  const seen = new Set<string>();
  const now = new Date().toISOString();

  for (let i = 0; i < allEntries.length; i++) {
    for (let j = i + 1; j < allEntries.length; j++) {
      const a = allEntries[i];
      const b = allEntries[j];

      // Skip entries from the same source
      if (a.sourceRef === b.sourceRef) continue;

      // Skip same category + same content
      if (a.category === b.category && a.content === b.content) continue;

      // Calculate connection strength
      let score = tagOverlap(a, b);

      // Boost for shared entities
      if (hasSharedEntities(a, b)) {
        score = Math.max(score, 0.5);
      }

      // Boost for same domain
      if (sameDomain(a, b)) {
        score = Math.max(score, 0.4);
      }

      // Cross-category connections are especially interesting
      if (a.category !== b.category && score >= MIN_CONNECTION_SCORE) {
        score += 0.1;
      }

      if (score >= MIN_CONNECTION_SCORE) {
        const key = [a.id, b.id].sort().join("|");
        if (!seen.has(key)) {
          seen.add(key);
          connections.push({
            entryIds: [a.id, b.id],
            description: `${a.category}:"${truncate(a.content)}" <-> ${b.category}:"${truncate(b.content)}"`,
            confidence: scoreToConfidence(score),
            proposedAt: now,
          });
        }
      }
    }
  }

  return {
    analyzedCount: allEntries.length,
    connections,
  };
}

function truncate(text: string, maxLen = 60): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

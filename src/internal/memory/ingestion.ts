/**
 * Memory ingestion — parse raw conversation logs into structured knowledge entries.
 *
 * Extracts preferences, relationships, domain expertise, and contextual knowledge
 * from raw conversation text using pattern matching. Local model summarization
 * is used when available; pattern-based extraction is the fallback.
 */

import type {
  Confidence,
  ContextEntry,
  DomainExpertiseEntry,
  IngestionResult,
  KnowledgeCategory,
  PreferenceEntry,
  RawConversationEntry,
  RelationshipEntry,
  StructuredMemoryEntry,
} from "./types.js";

/** Approximate bytes per token for size estimation. */
const BYTES_PER_TOKEN = 4;

/** Generate a unique memory entry ID. */
function generateId(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `mem-${ts}-${rand}`;
}

// --- Pattern-based extractors ---

/** Patterns that indicate user preferences. */
const PREFERENCE_PATTERNS = [
  /(?:i\s+prefer|i\s+like|i\s+want|please\s+always|please\s+never|i'd\s+rather|make\s+sure\s+to)\s+(.+?)(?:\.|$)/gi,
  /(?:don't|do\s+not|never)\s+(.+?)(?:\.|$)/gi,
];

/** Patterns that indicate relationships between entities. */
const RELATIONSHIP_PATTERNS = [
  /(\w+(?:\s+\w+)?)\s+(?:is\s+my|works\s+(?:with|for|at)|reports\s+to|manages)\s+(.+?)(?:\.|$)/gi,
  /(?:my\s+(?:colleague|boss|manager|team|friend|partner|client))\s+(\w+(?:\s+\w+)?)/gi,
];

/** Patterns that indicate domain knowledge. */
const DOMAIN_PATTERNS = [
  /(?:working\s+(?:on|with)|using|learning|building\s+(?:with|in))\s+(\w+(?:\s+\w+)?)/gi,
  /(?:expertise\s+in|experienced\s+with|skilled\s+in)\s+(.+?)(?:\.|$)/gi,
];

/** Patterns that indicate contextual/situational information. */
const CONTEXT_PATTERNS = [
  /(?:right\s+now|currently|this\s+week|today|this\s+month)\s+(.+?)(?:\.|$)/gi,
  /(?:deadline|due|meeting|appointment)\s+(.+?)(?:\.|$)/gi,
];

function extractByPatterns(
  text: string,
  patterns: RegExp[],
): { match: string; confidence: Confidence }[] {
  const results: { match: string; confidence: Confidence }[] = [];
  for (const pattern of patterns) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const content = (m[1] ?? m[0]).trim();
      if (content.length > 5 && content.length < 500) {
        results.push({ match: content, confidence: "medium" });
      }
    }
  }
  return results;
}

function createPreference(match: string, sourceRef: string, now: string): PreferenceEntry {
  return {
    id: generateId(),
    category: "preferences",
    content: match,
    tags: extractTags(match),
    confidence: "medium",
    createdAt: now,
    lastAccessedAt: now,
    sourceRef,
    parentId: null,
  };
}

function createRelationship(match: string, sourceRef: string, now: string): RelationshipEntry {
  const words = match.split(/\s+/).filter((w) => w.length > 2);
  return {
    id: generateId(),
    category: "relationships",
    content: match,
    tags: extractTags(match),
    confidence: "medium",
    createdAt: now,
    lastAccessedAt: now,
    sourceRef,
    entities: words.slice(0, 2),
    relationshipType: "associated",
  };
}

function createDomainExpertise(match: string, sourceRef: string, now: string): DomainExpertiseEntry {
  return {
    id: generateId(),
    category: "domain_expertise",
    content: match,
    tags: extractTags(match),
    confidence: "medium",
    createdAt: now,
    lastAccessedAt: now,
    sourceRef,
    domain: match.split(/\s+/)[0]?.toLowerCase() ?? "general",
  };
}

function createContext(match: string, sourceRef: string, now: string): ContextEntry {
  return {
    id: generateId(),
    category: "context",
    content: match,
    tags: extractTags(match),
    confidence: "medium",
    createdAt: now,
    lastAccessedAt: now,
    sourceRef,
    expiresAt: null,
  };
}

/** Extract simple tags from content text. */
function extractTags(text: string): string[] {
  const words = text.toLowerCase().split(/\s+/);
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been",
    "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "as", "into", "about",
    "that", "this", "it", "its", "my", "your", "i", "me", "and",
    "or", "not", "no", "but", "if", "so", "up", "out", "all",
  ]);
  return [...new Set(
    words
      .filter((w) => w.length > 2 && !stopWords.has(w))
      .slice(0, 5),
  )];
}

// --- Category weights for deduplication ---

const CATEGORY_EXTRACTORS: {
  category: KnowledgeCategory;
  patterns: RegExp[];
  create: (match: string, sourceRef: string, now: string) => StructuredMemoryEntry;
}[] = [
  { category: "preferences", patterns: PREFERENCE_PATTERNS, create: createPreference },
  { category: "relationships", patterns: RELATIONSHIP_PATTERNS, create: createRelationship },
  { category: "domain_expertise", patterns: DOMAIN_PATTERNS, create: createDomainExpertise },
  { category: "context", patterns: CONTEXT_PATTERNS, create: createContext },
];

/**
 * Ingest a raw conversation entry into structured knowledge entries.
 *
 * Uses pattern-based extraction to identify preferences, relationships,
 * domain expertise, and contextual knowledge from raw text.
 */
export function ingest(raw: RawConversationEntry): IngestionResult {
  const now = new Date().toISOString();
  const entries: StructuredMemoryEntry[] = [];
  const seen = new Set<string>();

  for (const { patterns, create } of CATEGORY_EXTRACTORS) {
    const matches = extractByPatterns(raw.text, patterns);
    for (const { match } of matches) {
      const key = match.toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        entries.push(create(match, raw.sessionId, now));
      }
    }
  }

  const rawTokenCount = Math.ceil(raw.text.length / BYTES_PER_TOKEN);
  const structuredTokenCount = entries.reduce(
    (sum, e) => sum + Math.ceil(e.content.length / BYTES_PER_TOKEN),
    0,
  );

  return { entries, rawTokenCount, structuredTokenCount };
}

/**
 * Ingest multiple raw conversation entries.
 */
export function ingestBatch(raws: RawConversationEntry[]): IngestionResult {
  const allEntries: StructuredMemoryEntry[] = [];
  let totalRawTokens = 0;
  let totalStructuredTokens = 0;

  for (const raw of raws) {
    const result = ingest(raw);
    allEntries.push(...result.entries);
    totalRawTokens += result.rawTokenCount;
    totalStructuredTokens += result.structuredTokenCount;
  }

  return {
    entries: allEntries,
    rawTokenCount: totalRawTokens,
    structuredTokenCount: totalStructuredTokens,
  };
}

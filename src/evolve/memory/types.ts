/**
 * Structured memory types for the knowledge graph.
 *
 * Memory is organized into four knowledge categories (preferences, relationships,
 * domain_expertise, context) and three storage tiers (hot, warm, cold) based on
 * recency and access patterns.
 */

// --- Knowledge categories ---

export type KnowledgeCategory = "preferences" | "relationships" | "domain_expertise" | "context";

/** Confidence level for extracted knowledge. */
export type Confidence = "high" | "medium" | "low";

/** Base fields shared by all structured memory entries. */
export interface MemoryEntryBase {
  /** Unique identifier (e.g., "mem-1710000000000-abc"). */
  id: string;
  /** Knowledge category. */
  category: KnowledgeCategory;
  /** Human-readable summary of the knowledge. */
  content: string;
  /** Tags for retrieval (e.g., ["email", "morning-routine"]). */
  tags: string[];
  /** Extraction confidence. */
  confidence: Confidence;
  /** ISO timestamp when this entry was created. */
  createdAt: string;
  /** ISO timestamp of the last access or relevance check. */
  lastAccessedAt: string;
  /** Source conversation or session reference. */
  sourceRef: string;
}

/**
 * Hierarchical preference entry.
 * Preferences can have parent-child relationships for specificity
 * (e.g., "prefers email" > "prefers email summaries in bullet points").
 */
export interface PreferenceEntry extends MemoryEntryBase {
  category: "preferences";
  /** Parent preference ID, if this is a refinement. */
  parentId: string | null;
}

/**
 * Cross-linked relationship entry.
 * Tracks connections between entities (people, projects, tools).
 */
export interface RelationshipEntry extends MemoryEntryBase {
  category: "relationships";
  /** The entities involved in this relationship. */
  entities: string[];
  /** Nature of the relationship (e.g., "colleague", "reports-to", "depends-on"). */
  relationshipType: string;
}

/**
 * Domain expertise entry.
 * Captures knowledge about specific domains the user works in.
 */
export interface DomainExpertiseEntry extends MemoryEntryBase {
  category: "domain_expertise";
  /** Domain name (e.g., "typescript", "kubernetes", "finance"). */
  domain: string;
}

/**
 * Contextual knowledge entry.
 * Situational awareness — ongoing projects, current priorities, recent events.
 */
export interface ContextEntry extends MemoryEntryBase {
  category: "context";
  /** Optional expiry for time-bound context. */
  expiresAt: string | null;
}

/** Union of all structured memory entry types. */
export type StructuredMemoryEntry =
  | PreferenceEntry
  | RelationshipEntry
  | DomainExpertiseEntry
  | ContextEntry;

// --- Tiers ---

export type MemoryTierName = "hot" | "warm" | "cold";

/** Policy configuration for tier transitions. */
export interface TierPolicy {
  /** Maximum size in bytes for the hot tier. */
  hotMaxBytes: number;
  /** Maximum age in days for the hot tier. */
  hotMaxDays: number;
  /** Maximum age in days for the warm tier before moving to cold. */
  warmMaxDays: number;
  /** Whether to delete cold entries beyond coldMaxDays (vs. keep forever). */
  deleteColdBeyondMax: boolean;
  /** Maximum age in days for cold tier (only if deleteColdBeyondMax is true). */
  coldMaxDays: number;
}

/** Default tier policy matching acceptance criteria. */
export const DEFAULT_TIER_POLICY: TierPolicy = {
  hotMaxBytes: 100 * 1024, // 100KB
  hotMaxDays: 7,
  warmMaxDays: 90,
  deleteColdBeyondMax: false,
  coldMaxDays: 365,
};

// --- Ingestion ---

/** A raw conversation log entry to be parsed into structured knowledge. */
export interface RawConversationEntry {
  /** ISO timestamp of the conversation. */
  timestamp: string;
  /** The raw conversation text. */
  text: string;
  /** Session or conversation identifier. */
  sessionId: string;
}

/** Result of ingesting a raw conversation into structured entries. */
export interface IngestionResult {
  entries: StructuredMemoryEntry[];
  rawTokenCount: number;
  structuredTokenCount: number;
}

// --- Tier transition ---

/** Result of a tier transition operation. */
export interface TransitionResult {
  moved: number;
  deleted: number;
  summarized: number;
  piiMasked: number;
}

// --- Reflection ---

/** A proposed connection discovered during background reflection. */
export interface ProposedConnection {
  /** IDs of the entries that are connected. */
  entryIds: string[];
  /** Description of the discovered connection. */
  description: string;
  /** Confidence in this connection. */
  confidence: Confidence;
  /** ISO timestamp of when this was proposed. */
  proposedAt: string;
}

/** Result of a background reflection pass. */
export interface ReflectionResult {
  analyzedCount: number;
  connections: ProposedConnection[];
}

// --- Health report ---

/** Memory health report for doctor/status integration. */
export interface MemoryHealthReport {
  tiers: {
    name: MemoryTierName;
    entryCount: number;
    sizeBytes: number;
    oldestEntryAge: number | null;
    newestEntryAge: number | null;
  }[];
  totalEntries: number;
  totalSizeBytes: number;
  hotTierOverBudget: boolean;
  staleEntriesCount: number;
  pendingTransitions: number;
  pendingConnections: number;
}

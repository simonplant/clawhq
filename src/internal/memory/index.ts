/**
 * Memory lifecycle management — structured knowledge graph.
 *
 * Transforms raw conversation logs into structured knowledge entries,
 * manages tiered storage (hot/warm/cold) with automatic transitions,
 * and runs background reflection to discover new connections.
 */

export type {
  Confidence,
  ContextEntry,
  DomainExpertiseEntry,
  IngestionResult,
  KnowledgeCategory,
  MemoryEntryBase,
  MemoryHealthReport,
  MemoryTierName,
  PreferenceEntry,
  ProposedConnection,
  RawConversationEntry,
  ReflectionResult,
  RelationshipEntry,
  StructuredMemoryEntry,
  TierPolicy,
  TransitionResult,
} from "./types.js";
export { DEFAULT_TIER_POLICY } from "./types.js";

export { ingest, ingestBatch } from "./ingestion.js";

export {
  collectMemoryHealth,
  deleteEntry,
  entryAgeDays,
  findTransitionCandidates,
  listEntries,
  readEntry,
  tierSize,
  writeEntry,
} from "./store.js";

export {
  cleanupCold,
  fallbackSummarize,
  maskPII,
  runAllTransitions,
  transitionHotToWarm,
  transitionWarmToCold,
} from "./transitions.js";
export type { Summarizer } from "./transitions.js";

export { reflect } from "./reflection.js";

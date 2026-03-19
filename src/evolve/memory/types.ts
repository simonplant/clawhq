/**
 * Types for memory lifecycle management.
 *
 * Memory is organized into three tiers:
 * - **Hot**: Recent, full-fidelity memories in active context
 * - **Warm**: Summarized memories available for recall
 * - **Cold**: Archived, PII-masked memories for long-term retention
 *
 * Automatic transitions move memories through tiers based on age
 * and configurable retention policies.
 */

// ── Memory Tiers ────────────────────────────────────────────────────────────

/** The three memory storage tiers. */
export type MemoryTier = "hot" | "warm" | "cold";

/** Pipeline steps for memory lifecycle operations. */
export type MemoryPipelineStep =
  | "scan"
  | "summarize"
  | "mask"
  | "transition"
  | "cleanup";

/** Status of a pipeline step. */
export type MemoryStepStatus = "running" | "done" | "failed" | "skipped";

// ── Memory Entry ────────────────────────────────────────────────────────────

/**
 * A single memory entry tracked by the lifecycle system.
 *
 * Entries start in the hot tier and transition to warm (summarized)
 * and cold (archived + PII-masked) based on retention policy.
 */
export interface MemoryEntry {
  /** Unique memory ID (filename without extension). */
  readonly id: string;
  /** Current tier. */
  readonly tier: MemoryTier;
  /** ISO 8601 timestamp when the memory was created. */
  readonly createdAt: string;
  /** ISO 8601 timestamp of last tier transition. */
  readonly transitionedAt: string;
  /** Size in bytes of the memory file. */
  readonly sizeBytes: number;
  /** Whether the memory has been summarized. */
  readonly summarized: boolean;
  /** Whether PII has been masked. */
  readonly piiMasked: boolean;
  /** Original file path relative to workspace/memory/. */
  readonly relativePath: string;
}

// ── Memory Manifest ─────────────────────────────────────────────────────────

/** Manifest tracking all memory entries across tiers. */
export interface MemoryManifest {
  readonly version: 1;
  readonly entries: readonly MemoryEntry[];
  /** ISO 8601 timestamp of last lifecycle run. */
  readonly lastRunAt?: string;
}

// ── Memory Config ───────────────────────────────────────────────────────────

/**
 * Memory lifecycle configuration.
 *
 * Parsed from the blueprint's memory_policy and stored in clawhq.yaml.
 */
export interface MemoryLifecycleConfig {
  /** Maximum hot tier size in bytes. */
  readonly hotMaxBytes: number;
  /** Hours before hot → warm transition. */
  readonly hotRetentionHours: number;
  /** Hours before warm → cold transition. */
  readonly warmRetentionHours: number;
  /** Hours before cold entries are purged (0 = never). */
  readonly coldRetentionHours: number;
  /** Summarization strategy. */
  readonly summarization: "aggressive" | "balanced" | "conservative";
  /** Cron expression for scheduled lifecycle runs. */
  readonly scheduleExpr?: string;
}

// ── Transition Result ───────────────────────────────────────────────────────

/** Result of transitioning a single memory entry between tiers. */
export interface TransitionResult {
  readonly entryId: string;
  readonly fromTier: MemoryTier;
  readonly toTier: MemoryTier;
  readonly summarized: boolean;
  readonly piiMasked: boolean;
  readonly newSizeBytes: number;
}

/** Aggregate result from a full lifecycle run. */
export interface LifecycleRunResult {
  readonly success: boolean;
  readonly timestamp: string;
  readonly transitions: readonly TransitionResult[];
  readonly purged: readonly string[];
  readonly hotSizeBytes: number;
  readonly warmSizeBytes: number;
  readonly coldSizeBytes: number;
  readonly totalEntries: number;
  readonly error?: string;
}

// ── Summarization ───────────────────────────────────────────────────────────

/** Options for LLM-powered summarization. */
export interface SummarizeOptions {
  /** The full memory text to summarize. */
  readonly text: string;
  /** Summarization strategy. */
  readonly strategy: "aggressive" | "balanced" | "conservative";
  /** Ollama API base URL. */
  readonly ollamaUrl?: string;
  /** Model to use for summarization. */
  readonly model?: string;
}

/** Result from summarization. */
export interface SummarizeResult {
  readonly success: boolean;
  readonly summary?: string;
  readonly originalSize: number;
  readonly summarySize: number;
  readonly error?: string;
}

// ── Decision Trace ──────────────────────────────────────────────────────────

/** A logged decision trace entry. */
export interface DecisionTrace {
  /** Unique trace ID. */
  readonly id: string;
  /** ISO 8601 timestamp. */
  readonly timestamp: string;
  /** What the agent decided. */
  readonly decision: string;
  /** Why it made this decision (reasoning). */
  readonly reasoning: string;
  /** What action was taken. */
  readonly action: string;
  /** Outcome of the action. */
  readonly outcome: "success" | "failure" | "pending";
  /** User feedback on this decision (if any). */
  readonly feedback?: "approved" | "rejected" | "corrected";
}

// ── Preference Patterns ─────────────────────────────────────────────────────

/** A detected preference pattern from decision traces. */
export interface PreferencePattern {
  /** Pattern identifier. */
  readonly id: string;
  /** Human-readable description of the pattern. */
  readonly description: string;
  /** Category of the preference (e.g., "communication", "scheduling"). */
  readonly category: string;
  /** Number of supporting decision traces. */
  readonly supportCount: number;
  /** Confidence score (0.0 - 1.0). */
  readonly confidence: number;
  /** ISO 8601 timestamp when the pattern was first detected. */
  readonly detectedAt: string;
  /** ISO 8601 timestamp of the most recent supporting trace. */
  readonly lastSeenAt: string;
  /** Example trace IDs that support this pattern. */
  readonly exampleTraceIds: readonly string[];
}

/** Aggregate preference report visible to the user. */
export interface PreferenceReport {
  readonly patterns: readonly PreferencePattern[];
  readonly totalDecisions: number;
  readonly trackedSince: string;
  readonly generatedAt: string;
}

// ── Progress ────────────────────────────────────────────────────────────────

/** Progress event emitted during memory lifecycle operations. */
export interface MemoryProgress {
  readonly step: MemoryPipelineStep;
  readonly status: MemoryStepStatus;
  readonly message: string;
}

/** Callback for step-by-step progress reporting. */
export type MemoryProgressCallback = (progress: MemoryProgress) => void;

// ── Options ─────────────────────────────────────────────────────────────────

/** Options for running the memory lifecycle. */
export interface MemoryLifecycleOptions {
  /** Path to the deployment directory (default: ~/.clawhq). */
  readonly deployDir: string;
  /** Override lifecycle config (otherwise read from clawhq.yaml). */
  readonly config?: MemoryLifecycleConfig;
  /** Progress callback. */
  readonly onProgress?: MemoryProgressCallback;
}

/** Options for viewing memory status. */
export interface MemoryStatusOptions {
  readonly deployDir: string;
}

/** Options for viewing preference patterns. */
export interface PreferenceOptions {
  readonly deployDir: string;
}

/** Tier status summary for display. */
export interface TierStatus {
  readonly tier: MemoryTier;
  readonly entryCount: number;
  readonly totalSizeBytes: number;
}

/** Full memory status for display. */
export interface MemoryStatus {
  readonly tiers: readonly TierStatus[];
  readonly totalEntries: number;
  readonly totalSizeBytes: number;
  readonly lastRunAt?: string;
  readonly config: MemoryLifecycleConfig;
}

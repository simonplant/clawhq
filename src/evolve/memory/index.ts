/**
 * Memory lifecycle module — hot/warm/cold tiers with preference learning.
 *
 * Manages agent memory across three tiers so the agent gets smarter
 * over time without bloating context. PII is masked before cold storage.
 * Decision traces enable "why did you do that?" and preference learning.
 */

// Lifecycle engine
export {
  DEFAULT_CONFIG,
  loadManifest,
  runLifecycle,
  scanAllTiers,
} from "./lifecycle.js";

// Summarization
export { summarizeMemory } from "./summarize.js";

// Decision trace
export { logDecision, readTraces, recordFeedback } from "./trace.js";

// Preference patterns
export { analyzePreferences, loadPreferences } from "./preferences.js";

// Formatters
export {
  formatLifecycleResult,
  formatLifecycleResultJson,
  formatMemoryStatus,
  formatMemoryStatusJson,
  formatPreferenceReport,
  formatPreferenceReportJson,
} from "./format.js";

// Status helper
export { getMemoryStatus } from "./status.js";

// Types
export type {
  DecisionTrace,
  LifecycleRunResult,
  MemoryEntry,
  MemoryLifecycleConfig,
  MemoryLifecycleOptions,
  MemoryManifest,
  MemoryPipelineStep,
  MemoryProgress,
  MemoryProgressCallback,
  MemoryStatus,
  MemoryStepStatus,
  MemoryTier,
  PreferenceOptions,
  PreferencePattern,
  PreferenceReport,
  SummarizeOptions,
  SummarizeResult,
  TierStatus,
  TransitionResult,
} from "./types.js";

/**
 * Decision trace types.
 *
 * Every agent action records the rules, preferences, and context that drove
 * the decision. Users can query any action to understand why it was taken,
 * and corrections from trace context feed into preference learning.
 *
 * A decision trace consists of:
 * - DecisionEntry: the core record of a single decision
 * - DecisionFactor: a rule, preference, or context item that influenced the decision
 * - TraceQuery: parameters for looking up decision chains
 * - Explanation: natural-language summary generated from a trace
 */

// --- Decision factors ---

/** The kind of factor that influenced a decision. */
export type FactorKind = "rule" | "preference" | "context";

/** A single factor that influenced a decision. */
export interface DecisionFactor {
  /** What kind of factor this is. */
  kind: FactorKind;
  /** Source file where this factor is defined (e.g., "AGENTS.md", "USER.md"). */
  source: string;
  /** The specific text or rule that was applied. */
  content: string;
  /** How strongly this factor influenced the decision (0-1). */
  weight: number;
}

// --- Decision entries ---

/** A single recorded decision in the trace log. */
export interface DecisionEntry {
  /** Unique identifier, e.g. "dec-1710000000000-abc". */
  id: string;
  /** ISO timestamp of when the decision was made. */
  timestamp: string;
  /** The type of action taken (e.g., "email_triage", "calendar_update", "task_completion"). */
  actionType: string;
  /** Human-readable summary of what the agent decided to do. */
  summary: string;
  /** The factors that influenced this decision. */
  factors: DecisionFactor[];
  /** Optional parent decision ID for chained/multi-step actions. */
  parentId?: string;
  /** The final outcome or result of the action. */
  outcome: string;
}

// --- Decision store ---

/** Persistent store for decision entries. */
export interface DecisionStore {
  entries: DecisionEntry[];
}

// --- Trace query ---

/** Parameters for querying the decision trace. */
export interface TraceQuery {
  /** Look up a specific decision by ID. */
  id?: string;
  /** Filter by action type. */
  actionType?: string;
  /** Return decisions after this ISO timestamp. */
  since?: string;
  /** Return decisions before this ISO timestamp. */
  before?: string;
  /** Maximum number of entries to return. */
  limit?: number;
}

/** Result of a trace query, including the full decision chain. */
export interface TraceResult {
  /** The matching decision entries (ordered oldest → newest). */
  entries: DecisionEntry[];
  /** The full chain from root to the queried entry (when querying by ID). */
  chain: DecisionEntry[];
}

// --- Explanation ---

/** A natural-language explanation generated from a decision trace. */
export interface Explanation {
  /** The decision entry this explanation is for. */
  decisionId: string;
  /** User-friendly explanation text. */
  text: string;
  /** The specific rules and preferences cited. */
  citations: ExplanationCitation[];
  /** ISO timestamp of when this explanation was generated. */
  generatedAt: string;
}

/** A citation linking part of the explanation to a source. */
export interface ExplanationCitation {
  /** The source file (e.g., "USER.md", "AGENTS.md"). */
  source: string;
  /** The referenced content from that source. */
  content: string;
  /** Which factor kind this citation represents. */
  kind: FactorKind;
}

// --- Correction ---

/** A user correction submitted from trace context. */
export interface TraceCorrection {
  /** The decision being corrected. */
  decisionId: string;
  /** What the user thinks should have happened instead. */
  correctionText: string;
  /** ISO timestamp of the correction. */
  timestamp: string;
}

// --- Context ---

/** Context for trace operations. */
export interface TraceContext {
  /** Path to ClawHQ data directory. */
  clawhqDir: string;
}

// --- Error ---

export class TraceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "TraceError";
  }
}

/**
 * Preference learning types.
 *
 * Corrections from the user are classified into three signal types:
 * - preference: A recurring pattern the agent should learn (e.g., "I prefer bullet points")
 * - boundary: A hard rule the agent must never override (e.g., "never contact my ex")
 * - one-time: A situational correction not intended as a general rule
 *
 * Signals accumulate per category. When a threshold is reached, a preference
 * update is proposed for user approval before being applied to identity files.
 */

// --- Signal types ---

export type SignalType = "preference" | "boundary" | "one-time";

/** A single correction signal extracted from user feedback. */
export interface PreferenceSignal {
  /** Unique identifier, e.g. "sig-1710000000000-abc". */
  id: string;
  /** ISO timestamp of when the correction occurred. */
  timestamp: string;
  /** The type of agent action that was corrected. */
  actionType: string;
  /** What the agent originally decided to do. */
  originalDecision: string;
  /** What the user corrected it to. */
  correction: string;
  /** Classification of this signal. */
  signalType: SignalType;
  /** The identity file this signal applies to (e.g., "USER.md", "AGENTS.md"). */
  appliedToIdentity: string;
  /** Free-form category tag for grouping related signals (e.g., "email-tone", "scheduling"). */
  category: string;
}

// --- Classifier ---

/** Keywords and patterns that indicate boundary signals. */
export const BOUNDARY_INDICATORS = [
  "never",
  "absolutely not",
  "do not ever",
  "forbidden",
  "off limits",
  "must not",
  "under no circumstances",
] as const;

/** Keywords and patterns that indicate one-time overrides. */
export const ONE_TIME_INDICATORS = [
  "just this once",
  "this time only",
  "for now",
  "only today",
  "exception",
  "temporarily",
  "right now",
] as const;

// --- Accumulator ---

/** Accumulated signals for a single category. */
export interface CategoryAccumulation {
  /** The category key (e.g., "email-tone"). */
  category: string;
  /** The identity file these signals target. */
  appliedToIdentity: string;
  /** All signals in this category (excluding one-time). */
  signals: PreferenceSignal[];
  /** The dominant signal type in this category. */
  dominantType: SignalType;
}

/** Persistent store for all recorded signals. */
export interface SignalStore {
  signals: PreferenceSignal[];
}

// --- Threshold proposer ---

/** Default number of signals needed before proposing a preference update. */
export const DEFAULT_PROPOSAL_THRESHOLD = 5;

/** A proposed preference update derived from accumulated signals. */
export interface PreferenceProposal {
  /** Unique proposal identifier. */
  id: string;
  /** ISO timestamp of when this proposal was generated. */
  proposedAt: string;
  /** The category this proposal covers. */
  category: string;
  /** Target identity file. */
  targetFile: string;
  /** The proposed text to add to the identity file. */
  proposedText: string;
  /** How many signals contributed to this proposal. */
  signalCount: number;
  /** The dominant signal type. */
  signalType: SignalType;
  /** IDs of the signals that drove this proposal. */
  signalIds: string[];
  /** Whether the user has approved this proposal. */
  status: "pending" | "approved" | "rejected";
}

/** Persistent store for proposals. */
export interface ProposalStore {
  proposals: PreferenceProposal[];
}

// --- Identity updater ---

/** Result of applying a preference update to an identity file. */
export interface UpdateResult {
  /** The proposal that was applied. */
  proposalId: string;
  /** The identity file that was modified. */
  targetFile: string;
  /** The text that was appended. */
  addedText: string;
  /** ISO timestamp of when the update was applied. */
  appliedAt: string;
  /** Snapshot of the file content before the update (for rollback). */
  previousContent: string;
}

// --- Audit trail ---

export type AuditEventType =
  | "signal_recorded"
  | "proposal_created"
  | "proposal_approved"
  | "proposal_rejected"
  | "preference_applied"
  | "preference_rolled_back";

/** A single entry in the preference learning audit log. */
export interface AuditEntry {
  /** ISO timestamp. */
  timestamp: string;
  /** Type of event. */
  eventType: AuditEventType;
  /** Human-readable description. */
  description: string;
  /** Related signal, proposal, or update ID. */
  relatedId: string;
}

/** Persistent audit log. */
export interface AuditLog {
  entries: AuditEntry[];
}

// --- Context ---

export interface LearningContext {
  /** Path to OpenClaw home directory (contains workspace/). */
  openclawHome: string;
  /** Path to ClawHQ data directory. */
  clawhqDir: string;
}

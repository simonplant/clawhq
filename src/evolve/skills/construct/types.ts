/**
 * Types for the construct meta-skill — autonomous self-improvement loop.
 *
 * The construct skill follows a five-phase cycle:
 * Assess → Propose → Build → Deploy → Validate
 *
 * State is persisted across runs so the agent does not redundantly
 * reassess gaps or rebuild already-deployed skills.
 */

// ── Construct Phase ─────────────────────────────────────────────────────────

/** Phases of the construct cycle. */
export type ConstructPhase = "assess" | "propose" | "build" | "deploy" | "validate";

/** Status of a single phase execution. */
export type ConstructPhaseStatus = "pending" | "running" | "completed" | "failed" | "skipped";

/** All valid phase transitions. */
export const CONSTRUCT_PHASE_ORDER: readonly ConstructPhase[] = [
  "assess",
  "propose",
  "build",
  "deploy",
  "validate",
] as const;

// ── Gap ─────────────────────────────────────────────────────────────────────

/** Priority of an identified capability gap. */
export type GapPriority = "high" | "medium" | "low";

/** A capability gap identified during assessment. */
export interface ConstructGap {
  /** Unique gap identifier (kebab-case). */
  readonly id: string;
  /** Description of the missing capability. */
  readonly description: string;
  /** Evidence — why this gap was identified. */
  readonly evidence: string;
  /** Priority for addressing. */
  readonly priority: GapPriority;
  /** Whether this gap can be addressed by a new skill. */
  readonly addressable: boolean;
  /** ISO 8601 timestamp when this gap was assessed. */
  readonly assessedAt: string;
}

// ── Proposal ────────────────────────────────────────────────────────────────

/** Skill boundaries specification. */
export interface SkillBoundaries {
  readonly network_access: boolean;
  readonly file_write: boolean;
  readonly account_changes: boolean;
  readonly auto_send: boolean;
}

/** A skill proposal generated from a gap. */
export interface ConstructProposal {
  /** Gap ID this proposal addresses. */
  readonly gapId: string;
  /** ISO 8601 timestamp of proposal. */
  readonly proposedAt: string;
  /** Proposed skill name. */
  readonly skillName: string;
  /** One-line description. */
  readonly description: string;
  /** Proposed cron schedule. */
  readonly schedule: string;
  /** Required tool and skill dependencies. */
  readonly dependencies: {
    readonly tools: readonly string[];
    readonly skills: readonly string[];
  };
  /** Proposed boundaries. */
  readonly boundaries: SkillBoundaries;
  /** Whether approval is required at runtime. */
  readonly approvalRequired: boolean;
  /** 3-5 bullet points of expected behavior. */
  readonly behaviorSummary: readonly string[];
  /** Rationale for the proposal. */
  readonly rationale: string;
  /** Whether the user approved this proposal. */
  readonly approved: boolean;
}

// ── Build Artifact ──────────────────────────────────────────────────────────

/** A built skill artifact ready for deployment. */
export interface ConstructArtifact {
  /** Skill name. */
  readonly skillName: string;
  /** ISO 8601 timestamp of build. */
  readonly builtAt: string;
  /** Map of relative file paths to file contents. */
  readonly files: Readonly<Record<string, string>>;
}

// ── Cycle ───────────────────────────────────────────────────────────────────

/** Result of a single phase execution. */
export interface ConstructPhaseResult {
  readonly phase: ConstructPhase;
  readonly status: ConstructPhaseStatus;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly error?: string;
}

/** A single construct cycle (one full assess→validate run). */
export interface ConstructCycle {
  /** Unique cycle identifier. */
  readonly id: string;
  /** ISO 8601 timestamp when the cycle started. */
  readonly startedAt: string;
  /** ISO 8601 timestamp when the cycle completed. */
  readonly completedAt?: string;
  /** Phase results for this cycle. */
  readonly phases: readonly ConstructPhaseResult[];
  /** Gaps identified in this cycle's assess phase. */
  readonly gaps: readonly string[];
  /** Proposals generated in this cycle. */
  readonly proposals: readonly string[];
  /** Skills successfully deployed in this cycle. */
  readonly deployed: readonly string[];
  /** Skills validated in this cycle. */
  readonly validated: readonly string[];
}

// ── Persistent State ────────────────────────────────────────────────────────

/** Persistent construct state — survives across runs. */
export interface ConstructState {
  /** State format version. */
  readonly version: 1;
  /** All assessed gaps (keyed by gap ID). */
  readonly gaps: Readonly<Record<string, ConstructGap>>;
  /** All proposals (keyed by skill name). */
  readonly proposals: Readonly<Record<string, ConstructProposal>>;
  /** All built artifacts (keyed by skill name). */
  readonly artifacts: Readonly<Record<string, ConstructArtifact>>;
  /** History of construct cycles. */
  readonly cycles: readonly ConstructCycle[];
  /** ISO 8601 timestamp of last state update. */
  readonly lastUpdatedAt: string;
}

/** Options for running the construct cycle. */
export interface ConstructRunOptions {
  /** Path to the deployment directory (default: ~/.clawhq). */
  readonly deployDir: string;
  /** Progress callback for phase-by-phase reporting. */
  readonly onProgress?: ConstructProgressCallback;
}

/** Progress event during construct execution. */
export interface ConstructProgress {
  readonly phase: ConstructPhase;
  readonly status: ConstructPhaseStatus;
  readonly message: string;
}

/** Callback for phase-by-phase progress. */
export type ConstructProgressCallback = (progress: ConstructProgress) => void;

/** Result of a full construct run. */
export interface ConstructRunResult {
  readonly success: boolean;
  readonly cycleId: string;
  readonly gapsFound: number;
  readonly proposalsGenerated: number;
  readonly skillsDeployed: number;
  readonly skillsValidated: number;
  readonly error?: string;
}

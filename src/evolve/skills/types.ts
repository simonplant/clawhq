/**
 * Types for skill lifecycle management.
 *
 * Skills follow a strict pipeline: stage → vet → approve → activate.
 * Every installation creates a rollback snapshot so the previous state
 * can be restored if a skill breaks the agent.
 */

// ── Skill Status ─────────────────────────────────────────────────────────────

/** Lifecycle status of an installed skill. */
export type SkillStatus = "staged" | "vetted" | "approved" | "active" | "rejected" | "rolled-back";

/** Pipeline step names for progress reporting. */
export type SkillPipelineStep = "stage" | "vet" | "approve" | "activate";

/** Status of a pipeline step. */
export type SkillStepStatus = "running" | "done" | "failed" | "skipped";

// ── Skill Manifest ───────────────────────────────────────────────────────────

/**
 * Metadata for an installed skill.
 *
 * Written to `~/.clawhq/workspace/skills/.skill-manifest.json`.
 * Each entry tracks where the skill came from, its vetting status,
 * and when it was installed/activated.
 */
export interface SkillManifestEntry {
  /** Skill name (directory name under workspace/skills/). */
  readonly name: string;
  /** Current lifecycle status. */
  readonly status: SkillStatus;
  /** Source the skill was installed from (path, URL, or registry name). */
  readonly source: string;
  /** ISO 8601 timestamp of staging. */
  readonly stagedAt: string;
  /** ISO 8601 timestamp of activation (if active). */
  readonly activatedAt?: string;
  /** Vetting report summary (if vetted). */
  readonly vetResult?: VetSummary;
  /** Rollback snapshot ID (if snapshot was taken). */
  readonly snapshotId?: string;
}

/** Full manifest file — array of skill entries. */
export interface SkillManifest {
  readonly version: 1;
  readonly skills: SkillManifestEntry[];
}

// ── Vetting ──────────────────────────────────────────────────────────────────

/** Category of security finding during skill vetting.
 * Flags obvious risks only — the real defense is the approval gate + egress firewall. */
export type VetFindingCategory =
  | "outbound_http"
  | "shell_execution"
  | "file_escape";

/** Severity of a vetting finding. */
export type VetSeverity = "critical" | "high" | "medium" | "low";

/** Single security finding from skill vetting. */
export interface VetFinding {
  readonly category: VetFindingCategory;
  readonly severity: VetSeverity;
  readonly file: string;
  readonly line: number;
  readonly detail: string;
  readonly matched: string;
}

/** Summary of vetting results. */
export interface VetSummary {
  readonly passed: boolean;
  readonly findingCount: number;
  readonly criticalCount: number;
  readonly highCount: number;
}

/** Full vetting report for a skill. */
export interface VetReport {
  readonly skillName: string;
  readonly passed: boolean;
  readonly findings: readonly VetFinding[];
  readonly summary: VetSummary;
  readonly timestamp: string;
}

// ── Rollback ─────────────────────────────────────────────────────────────────

/** Rollback snapshot metadata. */
export interface RollbackSnapshot {
  /** Unique snapshot ID. */
  readonly id: string;
  /** ISO 8601 timestamp. */
  readonly createdAt: string;
  /** Reason for snapshot (e.g., "pre-install: email-digest"). */
  readonly reason: string;
  /** Path to the snapshot directory. */
  readonly path: string;
}

// ── Pipeline Progress ────────────────────────────────────────────────────────

/** Progress event emitted during skill installation. */
export interface SkillProgress {
  readonly step: SkillPipelineStep;
  readonly status: SkillStepStatus;
  readonly message: string;
}

/** Callback for step-by-step progress reporting. */
export type SkillProgressCallback = (progress: SkillProgress) => void;

// ── Install Options ──────────────────────────────────────────────────────────

/** Options for skill installation. */
export interface SkillInstallOptions {
  /** Path to the deployment directory (default: ~/.clawhq). */
  readonly deployDir: string;
  /** Skill source (local path, URL, or registry name). */
  readonly source: string;
  /** Skip interactive approval (auto-approve if vetting passes). */
  readonly autoApprove?: boolean;
  /** Progress callback for step-by-step reporting. */
  readonly onProgress?: SkillProgressCallback;
}

/** Result of a skill installation. */
export interface SkillInstallResult {
  readonly success: boolean;
  readonly skillName: string;
  readonly status: SkillStatus;
  readonly vetReport?: VetReport;
  readonly snapshotId?: string;
  readonly error?: string;
}

// ── List Options ─────────────────────────────────────────────────────────────

/** Result of a single skill update. */
export interface SkillUpdateResult {
  readonly success: boolean;
  readonly skillName: string;
  readonly status: "updated" | "rolled-back" | "not-found" | "failed";
  readonly error?: string;
}

/** Options for listing installed skills. */
export interface SkillListOptions {
  readonly deployDir: string;
}

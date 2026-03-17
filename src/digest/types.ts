/**
 * Activity digest types.
 *
 * Defines the shape of activity log entries, digest reports, and options
 * for the `clawhq digest` command.
 */

// --- Activity log entries ---

/** Categories of agent activity. */
export type ActivityCategory =
  | "email"
  | "calendar"
  | "tasks"
  | "research"
  | "messaging"
  | "system"
  | "cron"
  | "approval"
  | "error"
  | "egress"
  | "other";

/** Types of activity. */
export type ActivityType =
  | "task_completed"
  | "task_queued"
  | "error"
  | "egress"
  | "approval_requested"
  | "approval_resolved"
  | "cron_run"
  | "integration_action"
  | "other";

/** A single activity log entry (one line in the JSONL file). */
export interface ActivityEntry {
  timestamp: string;
  type: ActivityType;
  category: ActivityCategory;
  summary: string;
  /** Detailed content (omitted in privacy mode). */
  details?: string;
  /** Provider or integration that produced this entry. */
  source?: string;
  /** Whether this action required approval. */
  approvalRequired?: boolean;
}

// --- Digest report ---

/** Summary of a single activity category. */
export interface CategorySummary {
  category: ActivityCategory;
  count: number;
  /** Human-readable summary of activity in this category. */
  highlights: string[];
}

/** Digest report assembled from activity log entries. */
export interface DigestReport {
  /** Period start (ISO 8601). */
  since: string;
  /** Period end (ISO 8601). */
  until: string;
  /** Whether privacy mode is active (category-only summaries). */
  privacyMode: boolean;
  /** Tasks completed autonomously. */
  tasksCompleted: string[];
  /** Tasks queued for approval. */
  tasksQueued: string[];
  /** Problems found with proposed solutions. */
  problems: ProblemEntry[];
  /** Activity breakdown by category. */
  categories: CategorySummary[];
  /** Data egress summary for the period. */
  egressSummary: DigestEgressSummary;
  /** Pending approvals from the approval queue. */
  pendingApprovals: DigestApprovalEntry[];
  /** Recent cron runs in the period. */
  cronRuns: DigestCronEntry[];
  /** Doctor warnings or failures (non-passing checks). */
  doctorWarnings: DigestDoctorEntry[];
  /** Total activity entries in the period. */
  totalEntries: number;
}

/** A problem the agent found, with a proposed solution. */
export interface ProblemEntry {
  /** Short description of the problem. */
  problem: string;
  /** Proposed solution or action. */
  proposal: string;
  /** Category this problem relates to. */
  category: ActivityCategory;
}

/** Egress summary embedded in the digest. */
export interface DigestEgressSummary {
  totalCalls: number;
  totalBytesOut: number;
  providers: string[];
  zeroEgress: boolean;
}

/** A pending approval entry surfaced in the digest. */
export interface DigestApprovalEntry {
  id: string;
  category: string;
  description: string;
  createdAt: string;
}

/** A cron run entry surfaced in the digest. */
export interface DigestCronEntry {
  jobName: string;
  ranAt: string;
  status: "success" | "failure" | "unknown";
  summary?: string;
}

/** A doctor warning or failure surfaced in the digest. */
export interface DigestDoctorEntry {
  name: string;
  status: "warn" | "fail";
  message: string;
  fix: string;
}

// --- Options ---

export interface DigestOptions {
  /** OpenClaw home directory. Default: ~/.openclaw */
  openclawHome?: string;
  /** Path to the activity log file. Default: <openclawHome>/activity.log */
  activityLogPath?: string;
  /** Path to the egress log file. Default: <openclawHome>/egress.log */
  egressLogPath?: string;
  /** Path to the approval queue file. Default: <openclawHome>/approvals.jsonl */
  approvalsPath?: string;
  /** Path to the cron run history file. Default: <openclawHome>/cron/history.jsonl */
  cronHistoryPath?: string;
  /** Only include entries since this date. Default: start of today. */
  since?: string;
  /** Only include entries until this date. Default: now. */
  until?: string;
  /** Privacy mode: summarize by category without showing content. */
  privacyMode?: boolean;
}

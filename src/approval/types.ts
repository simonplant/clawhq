/**
 * Approval queue types.
 *
 * Defines the shape of approval entries for high-stakes actions
 * that require user confirmation before execution.
 */

/** Status of an approval request. */
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

/** Categories that can require approval. */
export type ApprovalCategory =
  | "send_email"
  | "create_event"
  | "modify_calendar"
  | "post_public"
  | "purchase"
  | "delete_data"
  | "send_message"
  | "other";

/** A single approval queue entry. */
export interface ApprovalEntry {
  /** Unique identifier for this approval request. */
  id: string;
  /** When the approval was requested. */
  createdAt: string;
  /** Current status. */
  status: ApprovalStatus;
  /** Category of the action requiring approval. */
  category: ApprovalCategory;
  /** Human-readable description of what the agent wants to do. */
  description: string;
  /** Additional context for the approval decision. */
  details?: string;
  /** When the approval was resolved (approved/rejected/expired). */
  resolvedAt?: string;
  /** Rejection reason (stored as preference signal). */
  rejectionReason?: string;
  /** Timeout in milliseconds. Default: 24 hours. */
  timeoutMs: number;
}

/** Result of resolving an approval. */
export interface ApprovalResult {
  entry: ApprovalEntry;
  changed: boolean;
  message: string;
}

/** Options for the approval queue. */
export interface ApprovalQueueOptions {
  /** OpenClaw home directory. Default: ~/.openclaw */
  openclawHome?: string;
  /** Path to the approval queue file. Default: <openclawHome>/approvals.jsonl */
  queuePath?: string;
  /** Default timeout for new approvals in ms. Default: 86400000 (24h). */
  defaultTimeoutMs?: number;
}

/** Summary of the approval queue. */
export interface ApprovalQueueSummary {
  pending: number;
  approved: number;
  rejected: number;
  expired: number;
  total: number;
}

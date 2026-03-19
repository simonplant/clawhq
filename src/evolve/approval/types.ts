/**
 * Types for the approval queue.
 *
 * High-stakes agent actions (sending messages, account changes, etc.)
 * must queue for user approval before execution. No auto-send,
 * no auto-buy, no auto-delete without explicit user consent.
 */

// ── Approval Status ─────────────────────────────────────────────────────────

/** Status of an approval item. */
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

/** Category of action requiring approval. */
export type ApprovalCategory =
  | "send_email"
  | "send_message"
  | "account_change"
  | "public_post"
  | "delete"
  | "purchase"
  | "other";

// ── Approval Item ───────────────────────────────────────────────────────────

/** A single item awaiting user approval. */
export interface ApprovalItem {
  /** Unique approval ID. */
  readonly id: string;
  /** Category of action. */
  readonly category: ApprovalCategory;
  /** Human-readable summary of the proposed action. */
  readonly summary: string;
  /** Full detail of the proposed action (e.g., email body). */
  readonly detail: string;
  /** Source skill or context that generated this proposal. */
  readonly source: string;
  /** Current approval status. */
  readonly status: ApprovalStatus;
  /** ISO 8601 timestamp when queued. */
  readonly createdAt: string;
  /** ISO 8601 timestamp when resolved (approved/rejected). */
  readonly resolvedAt?: string;
  /** Optional metadata (e.g., recipient, subject). */
  readonly metadata?: Record<string, string>;
}

// ── Approval Queue ──────────────────────────────────────────────────────────

/** The full approval queue file structure. */
export interface ApprovalQueue {
  readonly version: 1;
  readonly items: readonly ApprovalItem[];
}

// ── Enqueue Options ─────────────────────────────────────────────────────────

/** Options for enqueuing a new approval item. */
export interface EnqueueOptions {
  readonly category: ApprovalCategory;
  readonly summary: string;
  readonly detail: string;
  readonly source: string;
  readonly metadata?: Record<string, string>;
}

/** Options for resolving (approving/rejecting) an approval item. */
export interface ResolveOptions {
  /** How the resolution was delivered (e.g., "cli", "telegram"). */
  readonly resolvedVia?: string;
}

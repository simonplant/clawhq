/**
 * Approval queue — high-stakes actions require user consent.
 *
 * Proposed actions (email replies, message sends, etc.) are queued
 * for user review. Nothing executes without explicit approval.
 */

export {
  approve,
  countPending,
  enqueue,
  getItem,
  listPending,
  loadQueue,
  pruneResolved,
  reject,
} from "./queue.js";

export type {
  ApprovalCategory,
  ApprovalItem,
  ApprovalQueue,
  ApprovalStatus,
  EnqueueOptions,
} from "./types.js";

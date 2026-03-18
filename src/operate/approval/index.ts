/**
 * Approval queue module.
 *
 * Provides approval queue functionality for high-stakes actions:
 * enqueue, approve, reject, expire, and Telegram notification.
 */

export type {
  ApprovalCategory,
  ApprovalEntry,
  ApprovalQueueOptions,
  ApprovalQueueSummary,
  ApprovalResult,
  ApprovalStatus,
} from "./types.js";

export {
  enqueue,
  getPending,
  getQueueSummary,
  readQueue,
  writeQueue,
} from "./queue.js";

export {
  approve,
  expireTimedOut,
  reject,
} from "./resolution.js";

export {
  formatApprovalJson,
  formatApprovalSummary,
  formatApprovalTable,
  formatApprovalTelegram,
} from "./format.js";

export type { NotifyResult } from "./notify.js";
export { notifyTelegram } from "./notify.js";

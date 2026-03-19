/**
 * Approval queue — high-stakes actions require user consent.
 *
 * Proposed actions (email replies, message sends, etc.) are queued
 * for user review. Nothing executes without explicit approval.
 *
 * Telegram integration: notifications with inline approve/reject buttons,
 * and a polling bot that resolves items from Telegram callbacks.
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
  ResolveOptions,
} from "./types.js";

// Telegram notifications
export {
  sendApprovalNotification,
  sendResolutionConfirmation,
} from "./notify.js";
export type { NotifyResult, TelegramConfig } from "./notify.js";

// Telegram approval bot
export { startApprovalBot } from "./telegram.js";
export type { ApprovalBotOptions } from "./telegram.js";

// Action gate — the primary integration point for high-stakes action enforcement
export { loadTelegramConfig, submitForApproval } from "./gate.js";
export type { GateOptions, GateResult } from "./gate.js";

/**
 * Preference learning from corrections.
 *
 * Classifies user corrections into preference, boundary, or one-time signals,
 * accumulates them per category, proposes preference updates when thresholds
 * are reached, and applies approved updates to identity files with rollback.
 */

export type {
  AuditEntry,
  AuditEventType,
  AuditLog,
  CategoryAccumulation,
  LearningContext,
  PreferenceProposal,
  PreferenceSignal,
  ProposalStore,
  SignalStore,
  SignalType,
  UpdateResult,
} from "./types.js";
export { BOUNDARY_INDICATORS, DEFAULT_PROPOSAL_THRESHOLD, ONE_TIME_INDICATORS } from "./types.js";

export { classifyCorrection, createSignal } from "./classifier.js";

export {
  accumulateByCategory,
  determineDominantType,
  loadSignals,
  recordSignal,
  saveSignals,
} from "./accumulator.js";

export {
  approveProposal,
  checkAndPropose,
  getPendingProposals,
  loadProposals,
  rejectProposal,
  saveProposals,
  synthesizePreferenceText,
} from "./proposer.js";

export {
  applyProposal,
  listRollbacks,
  loadRollbacks,
  rollbackUpdate,
} from "./updater.js";

export { getAuditEntries, loadAuditLog, logEvent } from "./audit.js";

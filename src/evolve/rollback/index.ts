/**
 * Rollback module — capability-level rollback snapshots.
 *
 * Every capability change (integration, provider, role, skill) creates
 * a pre-change snapshot. Restore any snapshot to revert to a previous state.
 */

// Capability snapshots
export {
  createCapabilitySnapshot,
  listAllCapabilitySnapshots,
  listCapabilitySnapshots,
  restoreCapabilitySnapshot,
  restoreLatestCapabilitySnapshot,
} from "./capability-snapshot.js";

// Types
export type {
  CapabilityKind,
  CapabilitySnapshot,
  RestoreResult,
} from "./types.js";

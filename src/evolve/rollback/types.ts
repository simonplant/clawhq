/**
 * Types for generic capability rollback snapshots.
 *
 * Extends the skill-specific rollback pattern to cover all capability
 * changes: integrations, providers, roles, and skills. Every capability
 * change creates a pre-change snapshot so the previous state can be
 * restored cleanly.
 */

/** The kind of capability being snapshotted. */
export type CapabilityKind = "skills" | "integrations" | "providers" | "roles";

/** Metadata for a capability rollback snapshot. */
export interface CapabilitySnapshot {
  /** Unique snapshot ID. */
  readonly id: string;
  /** ISO 8601 timestamp. */
  readonly createdAt: string;
  /** What kind of capability was snapshotted. */
  readonly kind: CapabilityKind;
  /** Human-readable reason (e.g., "pre-add: email"). */
  readonly reason: string;
  /** Path to the snapshot directory. */
  readonly path: string;
}

/** Result of a restore operation. */
export interface RestoreResult {
  readonly success: boolean;
  readonly snapshotId?: string;
  readonly error?: string;
}

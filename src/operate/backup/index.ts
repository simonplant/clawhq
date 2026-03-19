/**
 * Encrypted backup and restore module.
 *
 * GPG-encrypted snapshots with SHA-256 integrity verification.
 * Post-restore doctor check confirms healthy agent state.
 */

// Backup creation + listing
export { createBackup, listSnapshots } from "./backup.js";

// Restore
export { restoreBackup } from "./restore.js";

// Types
export type {
  BackupCreateOptions,
  BackupCreateResult,
  BackupProgress,
  BackupProgressCallback,
  BackupRestoreOptions,
  BackupRestoreResult,
  BackupStep,
  RestoreStep,
  SnapshotManifest,
  SnapshotSummary,
  StepStatus,
} from "./types.js";

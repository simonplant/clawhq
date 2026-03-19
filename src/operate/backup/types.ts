/**
 * Types for encrypted backup and restore operations.
 *
 * Backups are GPG-encrypted, integrity-verified snapshots of the deployment
 * directory. Restore operations verify SHA-256 integrity, decrypt to a temp
 * directory, then run a post-restore doctor check to confirm agent health.
 */

// ── Pipeline Steps ───────────────────────────────────────────────────────────

/** Pipeline steps for backup creation progress. */
export type BackupStep = "collect" | "archive" | "encrypt" | "integrity" | "cleanup";

/** Pipeline steps for restore progress. */
export type RestoreStep = "verify" | "decrypt" | "extract" | "apply" | "doctor" | "cleanup";

/** Status of a pipeline step. */
export type StepStatus = "running" | "done" | "failed" | "skipped";

/** Progress event for backup/restore operations. */
export interface BackupProgress {
  readonly step: BackupStep | RestoreStep;
  readonly status: StepStatus;
  readonly message: string;
}

/** Callback for step-by-step progress reporting. */
export type BackupProgressCallback = (progress: BackupProgress) => void;

// ── Backup Options & Result ──────────────────────────────────────────────────

/** Options for creating a backup snapshot. */
export interface BackupCreateOptions {
  /** Path to the deployment directory (default: ~/.clawhq). */
  readonly deployDir: string;
  /** GPG passphrase for symmetric encryption. */
  readonly passphrase: string;
  /** Progress callback for step-by-step reporting. */
  readonly onProgress?: BackupProgressCallback;
}

/** Metadata stored alongside each snapshot. */
export interface SnapshotManifest {
  /** Manifest format version. */
  readonly version: 1;
  /** Unique snapshot identifier. */
  readonly snapshotId: string;
  /** ISO 8601 timestamp of snapshot creation. */
  readonly createdAt: string;
  /** SHA-256 hash of the encrypted archive. */
  readonly sha256: string;
  /** Number of files included in the snapshot. */
  readonly fileCount: number;
  /** Size of the encrypted archive in bytes. */
  readonly archiveSize: number;
}

/** Result of a backup creation operation. */
export interface BackupCreateResult {
  readonly success: boolean;
  /** Unique snapshot identifier. */
  readonly snapshotId?: string;
  /** Absolute path to the encrypted snapshot file. */
  readonly snapshotPath?: string;
  /** The snapshot manifest. */
  readonly manifest?: SnapshotManifest;
  readonly error?: string;
}

// ── List ─────────────────────────────────────────────────────────────────────

/** Summary of one available snapshot. */
export interface SnapshotSummary {
  /** Unique snapshot identifier. */
  readonly snapshotId: string;
  /** ISO 8601 timestamp of snapshot creation. */
  readonly createdAt: string;
  /** Size of the encrypted archive in bytes. */
  readonly archiveSize: number;
  /** SHA-256 hash of the encrypted archive. */
  readonly sha256: string;
  /** Number of files in the snapshot. */
  readonly fileCount: number;
}

// ── Restore Options & Result ─────────────────────────────────────────────────

/** Options for restoring from a backup snapshot. */
export interface BackupRestoreOptions {
  /** Path to the deployment directory (default: ~/.clawhq). */
  readonly deployDir: string;
  /** Snapshot ID or absolute path to the snapshot file. */
  readonly snapshot: string;
  /** GPG passphrase for decryption. */
  readonly passphrase: string;
  /** Progress callback for step-by-step reporting. */
  readonly onProgress?: BackupProgressCallback;
}

/** Result of a restore operation. */
export interface BackupRestoreResult {
  readonly success: boolean;
  /** Whether the post-restore doctor check passed. */
  readonly doctorHealthy?: boolean;
  /** Number of files restored. */
  readonly fileCount?: number;
  readonly error?: string;
}

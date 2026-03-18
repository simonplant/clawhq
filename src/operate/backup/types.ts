/**
 * Backup and restore type definitions.
 *
 * Covers encrypted snapshots of agent state: workspace, config,
 * credentials (.env), cron, and identity files.
 */

export interface BackupManifest {
  backupId: string;
  timestamp: string;
  version: number;
  secretsOnly: boolean;
  files: BackupFileEntry[];
  totalSize: number;
}

export interface BackupFileEntry {
  path: string;
  size: number;
  hash: string;
}

export interface BackupOptions {
  /** OpenClaw home directory (default: ~/.openclaw) */
  openclawHome: string;
  /** Directory to store backups (default: ~/.clawhq/backups/) */
  backupDir: string;
  /** GPG recipient for encryption (key ID or email) */
  gpgRecipient: string;
  /** Only back up sensitive files (.env, credentials) */
  secretsOnly?: boolean;
}

export interface BackupResult {
  backupId: string;
  archivePath: string;
  manifest: BackupManifest;
}

export interface BackupEntry {
  backupId: string;
  timestamp: string;
  secretsOnly: boolean;
  totalSize: number;
  archivePath: string;
}

export interface RestoreOptions {
  /** Backup ID to restore */
  backupId: string;
  /** Directory where backups are stored */
  backupDir: string;
  /** OpenClaw home directory to restore into */
  openclawHome: string;
}

export interface RestoreResult {
  backupId: string;
  filesRestored: number;
  integrityPassed: boolean;
  doctorPassed: boolean;
  doctorChecks: { pass: number; warn: number; fail: number };
}

export class BackupError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "BackupError";
  }
}

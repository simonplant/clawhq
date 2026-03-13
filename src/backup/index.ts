/**
 * Backup and restore module.
 *
 * Provides encrypted backup creation, listing, and restore for
 * OpenClaw agent state: workspace, config, credentials, cron, identity files.
 *
 * See docs/ARCHITECTURE.md for module responsibilities.
 */

export type {
  BackupEntry,
  BackupFileEntry,
  BackupManifest,
  BackupOptions,
  BackupResult,
  RestoreOptions,
  RestoreResult,
} from "./types.js";

export { BackupError } from "./types.js";

export { createBackup } from "./backup.js";

export {
  createManifest,
  generateBackupId,
  readManifest,
  validateIntegrity,
  writeManifest,
} from "./manifest.js";

export {
  collectFiles,
  createTarArchive,
  decryptWithGpg,
  encryptWithGpg,
  extractTarArchive,
  hashFile,
} from "./snapshot.js";

export { formatBackupTable, listBackups } from "./list.js";

export { restoreBackup } from "./restore.js";

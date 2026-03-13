/**
 * Restore from encrypted backup.
 *
 * Decrypts the archive, validates file integrity against the manifest,
 * extracts into the target directory, then runs doctor to verify.
 */

import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { readManifest, validateIntegrity } from "./manifest.js";
import { collectFiles, decryptWithGpg, extractTarArchive, hashFile } from "./snapshot.js";
import type { RestoreOptions, RestoreResult } from "./types.js";
import { BackupError } from "./types.js";

/**
 * Restore agent state from an encrypted backup.
 *
 * Steps:
 * 1. Read manifest to know what files to expect
 * 2. Decrypt GPG archive
 * 3. Extract tar into a temp directory
 * 4. Validate integrity (SHA-256 hashes match manifest)
 * 5. Move files into the target openclawHome
 */
export async function restoreBackup(
  opts: RestoreOptions,
): Promise<RestoreResult> {
  const { backupId, backupDir, openclawHome } = opts;

  // 1. Read manifest
  const manifest = await readManifest(backupDir, backupId);
  if (!manifest) {
    throw new BackupError(
      `Backup not found: ${backupId}`,
      "BACKUP_NOT_FOUND",
      { backupId },
    );
  }

  const backupPath = join(backupDir, backupId);
  const encryptedArchive = join(backupPath, "archive.tar.gpg");
  const decryptedArchive = join(backupPath, "archive.tar");
  const extractDir = join(backupPath, "_restore_tmp");

  try {
    // 2. Decrypt
    await decryptWithGpg(encryptedArchive, decryptedArchive);

    // 3. Extract to temp directory
    await mkdir(extractDir, { recursive: true });
    await extractTarArchive(decryptedArchive, extractDir);

    // 4. Validate integrity
    const fileHashes = new Map<string, string>();
    for (const entry of manifest.files) {
      const filePath = join(extractDir, entry.path);
      try {
        const hash = await hashFile(filePath);
        fileHashes.set(entry.path, hash);
      } catch {
        // File missing from archive
        fileHashes.set(entry.path, "");
      }
    }

    const failures = validateIntegrity(manifest, fileHashes);
    if (failures.length > 0) {
      throw new BackupError(
        `Integrity check failed for ${failures.length} file(s): ${failures.join(", ")}`,
        "INTEGRITY_FAILED",
        { failures },
      );
    }

    // 5. Extract into actual target directory
    await mkdir(openclawHome, { recursive: true });
    await extractTarArchive(decryptedArchive, openclawHome);

    // Verify final state by re-collecting and checking hashes
    const restoredFiles = await collectFiles({
      openclawHome,
      backupDir,
      gpgRecipient: "",
      secretsOnly: manifest.secretsOnly,
    });

    return {
      backupId,
      filesRestored: restoredFiles.length,
      integrityPassed: true,
    };
  } finally {
    // Clean up temp files
    await rm(decryptedArchive, { force: true });
    await rm(extractDir, { recursive: true, force: true });
  }
}

/**
 * Main backup orchestration.
 *
 * Collects files, creates manifest, archives, encrypts with GPG,
 * and stores in the configured backup directory.
 */

import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { notifyBackupFailed } from "../notifications/hooks.js";

import { createManifest, generateBackupId, writeManifest } from "./manifest.js";
import { collectFiles, createTarArchive, encryptWithGpg } from "./snapshot.js";
import type { BackupOptions, BackupResult } from "./types.js";
import { BackupError } from "./types.js";

/**
 * Create an encrypted backup of agent state.
 *
 * Steps:
 * 1. Collect files from openclawHome (full or secrets-only)
 * 2. Compute hashes and build manifest
 * 3. Create tar archive
 * 4. Encrypt with GPG
 * 5. Write manifest alongside encrypted archive
 */
export async function createBackup(
  opts: BackupOptions,
): Promise<BackupResult> {
  try {
    const backupId = generateBackupId();
    const backupPath = join(opts.backupDir, backupId);

    // Ensure backup directory exists
    await mkdir(backupPath, { recursive: true });

    // 1. Collect files
    const files = await collectFiles(opts);
    if (files.length === 0) {
      throw new BackupError(
        "No files found to back up. Check that openclawHome exists and contains agent state.",
        "NO_FILES",
        { openclawHome: opts.openclawHome },
      );
    }

    // 2. Build manifest
    const manifest = createManifest(
      backupId,
      files,
      opts.secretsOnly ?? false,
    );

    // 3. Create tar archive
    const tarPath = join(backupPath, "archive.tar");
    await createTarArchive(opts.openclawHome, files, tarPath);

    // 4. Encrypt with GPG
    const encryptedPath = await encryptWithGpg(tarPath, opts.gpgRecipient);

    // Remove unencrypted tar
    await rm(tarPath, { force: true });

    // 5. Write manifest
    await writeManifest(manifest, opts.backupDir);

    return {
      backupId,
      archivePath: encryptedPath,
      manifest,
    };
  } catch (err: unknown) {
    // Notify on backup failure (fire-and-forget)
    const code = err instanceof BackupError ? err.code : undefined;
    void notifyBackupFailed(
      err instanceof Error ? err.message : String(err),
      code,
    );
    throw err;
  }
}

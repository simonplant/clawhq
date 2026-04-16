/**
 * Backup restore with integrity verification and post-restore doctor check.
 *
 * Restore pipeline:
 *   1. Verify — SHA-256 integrity check against manifest
 *   2. Decrypt — GPG symmetric decryption to temp directory
 *   3. Extract — unpack tar.gz archive in temp directory
 *   4. Apply — copy restored files to deployment directory
 *   5. Doctor — run post-restore health check
 *   6. Cleanup — remove temp directory
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { cp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { BACKUP_RESTORE_GPG_TIMEOUT_MS, BACKUP_RESTORE_TAR_TIMEOUT_MS, DIR_MODE_SECRET } from "../../config/defaults.js";
import { runDoctor } from "../doctor/doctor.js";
import type { DoctorReport } from "../doctor/types.js";

import type {
  BackupProgressCallback,
  BackupRestoreOptions,
  BackupRestoreResult,
  RestoreStep,
  SnapshotManifest,
  StepStatus,
} from "./types.js";
import { SNAPSHOTS_DIR, spawnWithStdin } from "./utils.js";

const execFileAsync = promisify(execFile);

// ── Helpers ─────────────────────────────────────────────────────────────────

function progress(
  cb: BackupProgressCallback | undefined,
  step: RestoreStep,
  status: StepStatus,
  message: string,
): void {
  cb?.({ step, status, message });
}

/** Compute SHA-256 hash of a file. */
async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Resolve a snapshot identifier to its encrypted file and manifest.
 *
 * Accepts either:
 *   - A snapshot ID (e.g., "snap-1234567890-abcdef12") → looks up in snapshots dir
 *   - An absolute path to a .gpg file → reads manifest from adjacent file
 */
function resolveSnapshot(
  deployDir: string,
  snapshot: string,
): { gpgPath: string; manifestPath: string } | null {
  // Absolute path
  if (snapshot.endsWith(".gpg") && existsSync(snapshot)) {
    const manifestPath = snapshot.replace(/\.tar\.gz\.gpg$/, ".manifest.json");
    if (existsSync(manifestPath)) {
      return { gpgPath: snapshot, manifestPath };
    }
    return null;
  }

  // Snapshot ID
  const snapsDir = join(deployDir, SNAPSHOTS_DIR);
  const gpgPath = join(snapsDir, `${snapshot}.tar.gz.gpg`);
  const manifestPath = join(snapsDir, `${snapshot}.manifest.json`);

  if (existsSync(gpgPath) && existsSync(manifestPath)) {
    return { gpgPath, manifestPath };
  }

  return null;
}

// ── Restore Pipeline ────────────────────────────────────────────────────────

/**
 * Restore from an encrypted backup snapshot.
 *
 * Verifies SHA-256 integrity, decrypts via GPG, extracts to a temp directory
 * for isolation, copies to deployment directory, and runs a post-restore
 * doctor check to confirm agent health.
 */
export async function restoreBackup(options: BackupRestoreOptions): Promise<BackupRestoreResult> {
  const { deployDir, snapshot, passphrase, onProgress } = options;

  if (!passphrase) {
    return { success: false, error: "Passphrase is required for decryption." };
  }

  // Resolve snapshot to file paths
  const resolved = resolveSnapshot(deployDir, snapshot);
  if (!resolved) {
    return { success: false, error: `Snapshot not found: ${snapshot}` };
  }

  const { gpgPath, manifestPath } = resolved;

  // Create isolated temp directory for restore operations
  const tempDir = join(tmpdir(), `clawhq-restore-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true, mode: DIR_MODE_SECRET });

  try {
    // ── Step 1: Verify integrity ──────────────────────────────────────
    progress(onProgress, "verify", "running", "Verifying SHA-256 integrity...");

    const manifestContent = await readFile(manifestPath, "utf-8");
    const manifest: SnapshotManifest = JSON.parse(manifestContent);

    const actualHash = await hashFile(gpgPath);
    if (actualHash !== manifest.sha256) {
      progress(onProgress, "verify", "failed", "SHA-256 mismatch — snapshot may be corrupted or tampered with");
      return {
        success: false,
        error: `Integrity check failed: expected SHA-256 ${manifest.sha256.slice(0, 16)}..., got ${actualHash.slice(0, 16)}...`,
      };
    }

    progress(onProgress, "verify", "done", `SHA-256 verified: ${manifest.sha256.slice(0, 16)}...`);

    // ── Step 2: Decrypt ───────────────────────────────────────────────
    progress(onProgress, "decrypt", "running", "Decrypting snapshot...");

    const decryptedPath = join(tempDir, "snapshot.tar.gz");

    await spawnWithStdin(
      "gpg",
      [
        "--batch",
        "--yes",
        "--decrypt",
        "--passphrase-fd", "0",
        "--output", decryptedPath,
        gpgPath,
      ],
      passphrase,
      BACKUP_RESTORE_GPG_TIMEOUT_MS,
    );

    progress(onProgress, "decrypt", "done", "Decryption complete");

    // ── Step 3: Extract ───────────────────────────────────────────────
    progress(onProgress, "extract", "running", "Extracting archive...");

    const extractDir = join(tempDir, "data");
    mkdirSync(extractDir, { recursive: true, mode: DIR_MODE_SECRET });

    await execFileAsync(
      "tar",
      ["xzf", decryptedPath, "-C", extractDir],
      { timeout: BACKUP_RESTORE_TAR_TIMEOUT_MS },
    );

    // Verify extraction produced files
    const extractedEntries = await readdir(extractDir);
    if (extractedEntries.length === 0) {
      progress(onProgress, "extract", "failed", "Archive was empty");
      return { success: false, error: "Extracted archive contained no files." };
    }

    progress(onProgress, "extract", "done", `Extracted to temp directory`);

    // ── Step 4: Apply ─────────────────────────────────────────────────
    progress(onProgress, "apply", "running", "Restoring files to deployment directory...");

    // Ensure deploy directory exists
    mkdirSync(deployDir, { recursive: true, mode: DIR_MODE_SECRET });

    // Copy extracted files to deployment directory
    // Preserve existing snapshots directory
    const restoredCount = await applyRestore(extractDir, deployDir);

    progress(onProgress, "apply", "done", `Restored ${restoredCount} entries`);

    // ── Step 5: Doctor check ──────────────────────────────────────────
    progress(onProgress, "doctor", "running", "Running post-restore doctor check...");

    let doctorReport: DoctorReport;
    try {
      doctorReport = await runDoctor({ deployDir });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      progress(onProgress, "doctor", "failed", `Doctor check error: ${message}`);
      // Restore succeeded even if doctor fails — report the status
      return { success: true, doctorHealthy: false, fileCount: restoredCount };
    }

    if (doctorReport.healthy) {
      progress(onProgress, "doctor", "done", "Post-restore doctor check: HEALTHY");
    } else {
      const errorCount = doctorReport.errors.length;
      const warnCount = doctorReport.warnings.length;
      progress(
        onProgress,
        "doctor",
        "done",
        `Post-restore doctor check: ${errorCount} error(s), ${warnCount} warning(s)`,
      );
    }

    return {
      success: true,
      doctorHealthy: doctorReport.healthy,
      fileCount: restoredCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Restore failed: ${message}` };
  } finally {
    // ── Step 6: Cleanup ─────────────────────────────────────────────
    progress(onProgress, "cleanup", "running", "Cleaning up temp directory...");
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    progress(onProgress, "cleanup", "done", "Temp directory removed");
  }
}

/**
 * Copy restored files from the temp extract directory to the deployment directory.
 *
 * Overwrites existing files but preserves the snapshots directory to avoid
 * destroying backup history during restore.
 */
async function applyRestore(sourceDir: string, deployDir: string): Promise<number> {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  let count = 0;

  for (const entry of entries) {
    const srcPath = join(sourceDir, entry.name);
    const destPath = join(deployDir, entry.name);

    // Skip the snapshots directory to preserve backup history
    if (entry.name === "ops") {
      // For ops/, only copy non-backup subdirectories
      await copyOpsSelectively(srcPath, join(deployDir, "ops"));
      count++;
      continue;
    }

    await cp(srcPath, destPath, { recursive: true, force: true });
    count++;
  }

  return count;
}

/** Copy ops/ subdirectories except backup/ to preserve snapshot history. */
async function copyOpsSelectively(sourceOps: string, destOps: string): Promise<void> {
  if (!existsSync(sourceOps)) return;
  mkdirSync(destOps, { recursive: true, mode: DIR_MODE_SECRET });

  const entries = await readdir(sourceOps, { withFileTypes: true });
  for (const entry of entries) {
    // Skip backup directory to preserve existing snapshots
    if (entry.name === "backup") continue;

    const srcPath = join(sourceOps, entry.name);
    const destPath = join(destOps, entry.name);
    await cp(srcPath, destPath, { recursive: true, force: true });
  }
}

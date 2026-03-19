/**
 * Encrypted backup snapshot creation.
 *
 * Creates GPG-encrypted, integrity-verified snapshots of the deployment
 * directory. Each snapshot includes a manifest with SHA-256 hash for
 * verification before restore.
 *
 * Pipeline:
 *   1. Collect — enumerate all files in the deployment directory
 *   2. Archive — create a tar.gz of the deployment directory
 *   3. Encrypt — GPG symmetric encryption of the archive
 *   4. Integrity — compute and store SHA-256 hash of the encrypted file
 *   5. Cleanup — remove the unencrypted intermediate archive
 */

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

import type {
  BackupCreateOptions,
  BackupCreateResult,
  BackupProgressCallback,
  BackupStep,
  SnapshotManifest,
  SnapshotSummary,
  StepStatus,
} from "./types.js";

const GPG_TIMEOUT_MS = 60_000;

/** Snapshot storage directory relative to deployment directory. */
const SNAPSHOTS_DIR = "ops/backup/snapshots";

// ── Helpers ─────────────────────────────────────────────────────────────────

function progress(
  cb: BackupProgressCallback | undefined,
  step: BackupStep,
  status: StepStatus,
  message: string,
): void {
  cb?.({ step, status, message });
}

/** Recursively collect all file paths in a directory. */
async function collectAllFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  if (!existsSync(dir)) return files;

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectAllFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Simple POSIX tar header (reused from export pattern). */
function tarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512);

  header.write(name.slice(0, 100), 0, 100, "utf-8");
  header.write("0000644\0", 100, 8, "utf-8");
  header.write("0001000\0", 108, 8, "utf-8");
  header.write("0001000\0", 116, 8, "utf-8");
  header.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "utf-8");
  const mtime = Math.floor(Date.now() / 1000);
  header.write(mtime.toString(8).padStart(11, "0") + "\0", 136, 12, "utf-8");
  header.write("0", 156, 1, "utf-8");

  // Compute checksum
  header.write("        ", 148, 8, "utf-8");
  let checksum = 0;
  for (let i = 0; i < 512; i++) {
    checksum += header[i];
  }
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf-8");

  return header;
}

/** Hash a file's contents with SHA-256. */
async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

/** Run a command with stdin input, returning a promise. */
function spawnWithStdin(
  cmd: string,
  args: string[],
  stdinData: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr.trim()}`));
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.stdin.write(stdinData);
    proc.stdin.end();
  });
}

function snapshotsDir(deployDir: string): string {
  return join(deployDir, SNAPSHOTS_DIR);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Backup Creation ─────────────────────────────────────────────────────────

/**
 * Create an encrypted backup snapshot of the deployment directory.
 *
 * Produces a GPG-encrypted tar.gz archive with SHA-256 integrity hash.
 * The snapshot is stored in `ops/backup/snapshots/` within the deploy dir.
 */
export async function createBackup(options: BackupCreateOptions): Promise<BackupCreateResult> {
  const { deployDir, passphrase, onProgress } = options;

  if (!existsSync(deployDir)) {
    return { success: false, error: `Deployment directory not found: ${deployDir}` };
  }

  if (!passphrase || passphrase.length < 8) {
    return { success: false, error: "Passphrase must be at least 8 characters." };
  }

  const snapshotId = `snap-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const snapsDir = snapshotsDir(deployDir);
  mkdirSync(snapsDir, { recursive: true });

  const archivePath = join(snapsDir, `${snapshotId}.tar.gz`);
  const encryptedPath = join(snapsDir, `${snapshotId}.tar.gz.gpg`);
  const manifestPath = join(snapsDir, `${snapshotId}.manifest.json`);

  try {
    // ── Step 1: Collect ─────────────────────────────────────────────────
    progress(onProgress, "collect", "running", "Inventorying agent data...");

    const allFiles = await collectAllFiles(deployDir);
    // Exclude the snapshots directory itself to avoid recursive backup
    const filesToBackup = allFiles.filter(
      (f) => !relative(deployDir, f).startsWith(SNAPSHOTS_DIR),
    );

    if (filesToBackup.length === 0) {
      progress(onProgress, "collect", "failed", "No files found to back up");
      return { success: false, error: "No agent data found to back up." };
    }

    progress(onProgress, "collect", "done", `Found ${filesToBackup.length} files`);

    // ── Step 2: Archive ─────────────────────────────────────────────────
    progress(onProgress, "archive", "running", "Creating tar.gz archive...");

    const tarChunks: Buffer[] = [];

    for (const filePath of filesToBackup) {
      const relativePath = relative(deployDir, filePath);
      const content = await readFile(filePath);
      tarChunks.push(tarHeader(relativePath, content.length));
      tarChunks.push(content);
      const pad = 512 - (content.length % 512);
      if (pad < 512) tarChunks.push(Buffer.alloc(pad));
    }

    // End-of-archive marker
    tarChunks.push(Buffer.alloc(1024));

    const tarBuf = Buffer.concat(tarChunks);

    // Gzip and write
    const gzip = createGzip({ level: 9 });
    const output = createWriteStream(archivePath);
    await pipeline(Readable.from(tarBuf), gzip, output);

    progress(onProgress, "archive", "done", `Archive created (${formatBytes(statSync(archivePath).size)})`);

    // ── Step 3: Encrypt ─────────────────────────────────────────────────
    progress(onProgress, "encrypt", "running", "Encrypting with GPG...");

    await spawnWithStdin(
      "gpg",
      [
        "--batch",
        "--yes",
        "--symmetric",
        "--cipher-algo", "AES256",
        "--passphrase-fd", "0",
        "--output", encryptedPath,
        archivePath,
      ],
      passphrase,
      GPG_TIMEOUT_MS,
    );

    progress(onProgress, "encrypt", "done", "GPG encryption complete");

    // ── Step 4: Integrity ───────────────────────────────────────────────
    progress(onProgress, "integrity", "running", "Computing SHA-256 hash...");

    const sha256 = await hashFile(encryptedPath);
    const archiveSize = statSync(encryptedPath).size;

    const manifest: SnapshotManifest = {
      version: 1,
      snapshotId,
      createdAt: new Date().toISOString(),
      sha256,
      fileCount: filesToBackup.length,
      archiveSize,
    };

    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

    progress(onProgress, "integrity", "done", `SHA-256: ${sha256.slice(0, 16)}...`);

    // ── Step 5: Cleanup ─────────────────────────────────────────────────
    progress(onProgress, "cleanup", "running", "Removing unencrypted archive...");

    await rm(archivePath, { force: true });

    progress(onProgress, "cleanup", "done", `Snapshot ${snapshotId} ready (${formatBytes(archiveSize)})`);

    return { success: true, snapshotId, snapshotPath: encryptedPath, manifest };
  } catch (error) {
    // Clean up partial artifacts on failure
    await rm(archivePath, { force: true }).catch((e) => console.warn(`[backup] Failed to clean up archive:`, e));
    await rm(encryptedPath, { force: true }).catch((e) => console.warn(`[backup] Failed to clean up encrypted file:`, e));
    await rm(manifestPath, { force: true }).catch((e) => console.warn(`[backup] Failed to clean up manifest:`, e));

    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Backup failed: ${message}` };
  }
}

// ── List Snapshots ──────────────────────────────────────────────────────────

/**
 * List available backup snapshots.
 *
 * Reads manifest files from the snapshots directory and returns summaries
 * sorted by creation date (newest first).
 */
export async function listSnapshots(deployDir: string): Promise<SnapshotSummary[]> {
  const snapsDir = snapshotsDir(deployDir);
  if (!existsSync(snapsDir)) return [];

  const entries = await readdir(snapsDir);
  const manifests = entries.filter((e) => e.endsWith(".manifest.json"));

  const summaries: SnapshotSummary[] = [];

  for (const manifestFile of manifests) {
    try {
      const content = await readFile(join(snapsDir, manifestFile), "utf-8");
      const manifest: SnapshotManifest = JSON.parse(content);

      // Verify the encrypted file still exists
      const gpgFile = join(snapsDir, `${manifest.snapshotId}.tar.gz.gpg`);
      if (!existsSync(gpgFile)) continue;

      summaries.push({
        snapshotId: manifest.snapshotId,
        createdAt: manifest.createdAt,
        archiveSize: manifest.archiveSize,
        sha256: manifest.sha256,
        fileCount: manifest.fileCount,
      });
    } catch (e) {
      console.warn(`[backup] Failed to read manifest ${manifestFile}:`, e);
    }
  }

  // Sort newest first
  summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return summaries;
}

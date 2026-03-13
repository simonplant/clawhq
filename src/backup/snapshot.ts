/**
 * Snapshot collection and GPG encryption.
 *
 * Collects agent state files (workspace, config, credentials, cron, identity)
 * into a tar archive, then encrypts with GPG.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";

import type { BackupFileEntry, BackupOptions } from "./types.js";
import { BackupError } from "./types.js";

const execFileAsync = promisify(execFile);

/** Paths relative to openclawHome that contain full agent state. */
const FULL_BACKUP_PATHS = [
  "openclaw.json",
  ".env",
  "workspace",
  "cron",
  "docker-compose.yml",
];

/** Paths relative to openclawHome for secrets-only backup. */
const SECRETS_ONLY_PATHS = [".env"];

/**
 * Recursively collect all files under a directory.
 */
async function collectFilesRecursive(dir: string): Promise<string[]> {
  const results: string[] = [];

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const s = await stat(fullPath);
    if (s.isDirectory()) {
      const sub = await collectFilesRecursive(fullPath);
      results.push(...sub);
    } else if (s.isFile()) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Compute SHA-256 hash of a file.
 */
export async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Collect files to include in the backup and compute their metadata.
 */
export async function collectFiles(
  opts: BackupOptions,
): Promise<BackupFileEntry[]> {
  const paths = opts.secretsOnly ? SECRETS_ONLY_PATHS : FULL_BACKUP_PATHS;
  const entries: BackupFileEntry[] = [];

  for (const relPath of paths) {
    const fullPath = join(opts.openclawHome, relPath);

    let s;
    try {
      s = await stat(fullPath);
    } catch {
      // Path doesn't exist — skip silently
      continue;
    }

    if (s.isFile()) {
      const hash = await hashFile(fullPath);
      entries.push({
        path: relPath,
        size: s.size,
        hash,
      });
    } else if (s.isDirectory()) {
      const files = await collectFilesRecursive(fullPath);
      for (const file of files) {
        const fileRelPath = relative(opts.openclawHome, file);
        const fileStat = await stat(file);
        const hash = await hashFile(file);
        entries.push({
          path: fileRelPath,
          size: fileStat.size,
          hash,
        });
      }
    }
  }

  return entries;
}

/**
 * Create a tar archive of the collected files.
 * Returns the path to the unencrypted tar file.
 */
export async function createTarArchive(
  openclawHome: string,
  files: BackupFileEntry[],
  outputPath: string,
): Promise<void> {
  const filePaths = files.map((f) => f.path);

  try {
    await execFileAsync("tar", [
      "cf",
      outputPath,
      "-C",
      openclawHome,
      ...filePaths,
    ]);
  } catch (err: unknown) {
    throw new BackupError(
      `Failed to create tar archive: ${err instanceof Error ? err.message : String(err)}`,
      "TAR_FAILED",
    );
  }
}

/**
 * Encrypt a file with GPG using the specified recipient.
 * Produces <inputPath>.gpg and removes the unencrypted file.
 */
export async function encryptWithGpg(
  inputPath: string,
  recipient: string,
): Promise<string> {
  const outputPath = `${inputPath}.gpg`;

  try {
    await execFileAsync("gpg", [
      "--batch",
      "--yes",
      "--recipient",
      recipient,
      "--trust-model",
      "always",
      "--output",
      outputPath,
      "--encrypt",
      inputPath,
    ]);
  } catch (err: unknown) {
    throw new BackupError(
      `GPG encryption failed: ${err instanceof Error ? err.message : String(err)}`,
      "GPG_ENCRYPT_FAILED",
    );
  }

  return outputPath;
}

/**
 * Decrypt a GPG-encrypted file.
 * Returns the path to the decrypted output.
 */
export async function decryptWithGpg(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  try {
    await execFileAsync("gpg", [
      "--batch",
      "--yes",
      "--output",
      outputPath,
      "--decrypt",
      inputPath,
    ]);
  } catch (err: unknown) {
    throw new BackupError(
      `GPG decryption failed: ${err instanceof Error ? err.message : String(err)}`,
      "GPG_DECRYPT_FAILED",
    );
  }
}

/**
 * Extract a tar archive into the target directory.
 */
export async function extractTarArchive(
  archivePath: string,
  targetDir: string,
): Promise<void> {
  try {
    await execFileAsync("tar", ["xf", archivePath, "-C", targetDir]);
  } catch (err: unknown) {
    throw new BackupError(
      `Failed to extract tar archive: ${err instanceof Error ? err.message : String(err)}`,
      "TAR_EXTRACT_FAILED",
    );
  }
}

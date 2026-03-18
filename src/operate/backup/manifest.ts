/**
 * Backup manifest generation and validation.
 *
 * Each backup includes a JSON manifest with file list, sizes, hashes,
 * timestamp, and backup ID for integrity verification during restore.
 */

import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { BackupFileEntry, BackupManifest } from "./types.js";

const MANIFEST_VERSION = 1;

/**
 * Generate a unique backup ID: timestamp + random suffix.
 */
export function generateBackupId(): string {
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const suffix = randomBytes(4).toString("hex");
  return `backup-${ts}-${suffix}`;
}

/**
 * Create a backup manifest from collected file entries.
 */
export function createManifest(
  backupId: string,
  files: BackupFileEntry[],
  secretsOnly: boolean,
): BackupManifest {
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return {
    backupId,
    timestamp: new Date().toISOString(),
    version: MANIFEST_VERSION,
    secretsOnly,
    files,
    totalSize,
  };
}

/**
 * Write the manifest JSON to the backup directory.
 */
export async function writeManifest(
  manifest: BackupManifest,
  backupDir: string,
): Promise<string> {
  const dir = join(backupDir, manifest.backupId);
  await mkdir(dir, { recursive: true });

  const manifestPath = join(dir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  return manifestPath;
}

/**
 * Read a manifest from a backup directory.
 */
export async function readManifest(
  backupDir: string,
  backupId: string,
): Promise<BackupManifest | null> {
  const manifestPath = join(backupDir, backupId, "manifest.json");
  try {
    const content = await readFile(manifestPath, "utf-8");
    return JSON.parse(content) as BackupManifest;
  } catch {
    return null;
  }
}

/**
 * Validate that restored files match the manifest hashes.
 * Returns list of files that failed integrity check.
 */
export function validateIntegrity(
  manifest: BackupManifest,
  fileHashes: Map<string, string>,
): string[] {
  const failures: string[] = [];

  for (const entry of manifest.files) {
    const actual = fileHashes.get(entry.path);
    if (actual !== entry.hash) {
      failures.push(entry.path);
    }
  }

  return failures;
}

/**
 * List available backups with IDs and timestamps.
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { readManifest } from "./manifest.js";
import type { BackupEntry } from "./types.js";

/**
 * List all available backups in the backup directory.
 * Returns entries sorted by timestamp (newest first).
 */
export async function listBackups(backupDir: string): Promise<BackupEntry[]> {
  let entries: string[];
  try {
    entries = await readdir(backupDir);
  } catch {
    return [];
  }

  const backups: BackupEntry[] = [];

  for (const entry of entries) {
    if (!entry.startsWith("backup-")) continue;

    const dirPath = join(backupDir, entry);
    const s = await stat(dirPath);
    if (!s.isDirectory()) continue;

    const manifest = await readManifest(backupDir, entry);
    if (!manifest) continue;

    // Find the archive file
    const archivePath = join(dirPath, "archive.tar.gpg");

    backups.push({
      backupId: manifest.backupId,
      timestamp: manifest.timestamp,
      secretsOnly: manifest.secretsOnly,
      totalSize: manifest.totalSize,
      archivePath,
    });
  }

  // Sort newest first
  backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return backups;
}

/**
 * Format backup list as a human-readable table.
 */
export function formatBackupTable(backups: BackupEntry[]): string {
  if (backups.length === 0) {
    return "No backups found.";
  }

  const lines: string[] = [];

  const idWidth = Math.max(2, ...backups.map((b) => b.backupId.length));
  const tsWidth = 20;

  lines.push(
    `${"ID".padEnd(idWidth)}  ${"TIMESTAMP".padEnd(tsWidth)}  ${"TYPE".padEnd(12)}  SIZE`,
  );
  lines.push("-".repeat(idWidth + tsWidth + 30));

  for (const b of backups) {
    const type = b.secretsOnly ? "secrets-only" : "full";
    const size = formatBytes(b.totalSize);
    const ts = b.timestamp.slice(0, 19).replace("T", " ");
    lines.push(
      `${b.backupId.padEnd(idWidth)}  ${ts.padEnd(tsWidth)}  ${type.padEnd(12)}  ${size}`,
    );
  }

  lines.push("");
  lines.push(`${backups.length} backup${backups.length === 1 ? "" : "s"} found.`);

  return lines.join("\n");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

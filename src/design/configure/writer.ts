/**
 * Atomic file writer for generated config.
 *
 * Never produces partial files. Uses the temp-file + fsync + rename pattern:
 * 1. Write content to a temporary file in the same directory
 * 2. fsync to ensure content is on disk
 * 3. Rename (atomic on POSIX) to the final path
 *
 * If any step fails, the temporary file is cleaned up and the target
 * path is never modified.
 */

import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { FILE_MODE_CONFIG } from "../../config/defaults.js";

import type { FileEntry, WriteResult } from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Temp file prefix for atomic writes. */
const TEMP_PREFIX = ".clawhq-tmp-";

// ── Errors ───────────────────────────────────────────────────────────────────

/** Error during atomic file writing. */
export class WriteError extends Error {
  readonly targetPath: string;

  constructor(targetPath: string, message: string, options?: ErrorOptions) {
    super(`Failed to write "${targetPath}": ${message}`, options);
    this.name = "WriteError";
    this.targetPath = targetPath;
  }
}

// ── Atomic Write ─────────────────────────────────────────────────────────────

/**
 * Write a single file atomically.
 *
 * Creates parent directories as needed. The target path is never left
 * in a partial state — either the full content is written or the
 * original file (if any) is untouched.
 *
 * @param absolutePath — Full path to the target file
 * @param content — File content to write
 * @param mode — File permission mode (default FILE_MODE_CONFIG / 0o644)
 */
export function writeFileAtomic(
  absolutePath: string,
  content: string,
  mode: number = FILE_MODE_CONFIG,
): void {
  const dir = dirname(absolutePath);
  const tempPath = join(dir, `${TEMP_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`);

  // Ensure parent directory exists
  mkdirSync(dir, { recursive: true });

  let fd: number | undefined;
  try {
    // Write to temp file
    fd = openSync(tempPath, "w", mode);
    writeSync(fd, content, 0, "utf-8");

    // Flush to disk
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;

    // Atomic rename
    renameSync(tempPath, absolutePath);
  } catch (error) {
    // Clean up temp file on failure
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* best effort */ }
    }
    try { unlinkSync(tempPath); } catch { /* may not exist */ }

    throw new WriteError(
      absolutePath,
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }
}

// ── Batch Write ──────────────────────────────────────────────────────────────

/**
 * Write multiple files atomically to a deploy directory.
 *
 * Each file is written individually using the atomic pattern. If any file
 * fails, previously written files remain (they were each atomically complete).
 *
 * @param deployDir — Root deployment directory (e.g. ~/.clawhq)
 * @param files — Files to write, with paths relative to deployDir
 * @returns WriteResult with list of written absolute paths
 */
export function writeBundle(
  deployDir: string,
  files: readonly FileEntry[],
): WriteResult {
  const resolvedDir = resolve(deployDir);
  const written: string[] = [];

  for (const file of files) {
    const absolutePath = join(resolvedDir, file.relativePath);
    writeFileAtomic(absolutePath, file.content, file.mode);
    written.push(absolutePath);
  }

  return { written, deployDir: resolvedDir };
}

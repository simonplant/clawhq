/**
 * Atomic file write helper.
 *
 * Single canonical implementation of the temp-file + fsync + rename pattern
 * used across the codebase. The temp name is cryptographically random
 * (`crypto.randomUUID()`) so concurrent atomic writes to the same target
 * path can never collide on the temp file — Date.now()+Math.random() (the
 * prior pattern) has ~36^10 entropy and can collide under fast-retry loops.
 */

import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { FILE_MODE_CONFIG } from "./defaults.js";

/** Error during atomic file writing. */
export class WriteError extends Error {
  readonly targetPath: string;

  constructor(targetPath: string, message: string, options?: ErrorOptions) {
    super(`Failed to write "${targetPath}": ${message}`, options);
    this.name = "WriteError";
    this.targetPath = targetPath;
  }
}

const TEMP_PREFIX = ".clawhq-tmp-";

/**
 * Write `content` to `absolutePath` atomically.
 *
 * Steps:
 *   1. Create parent dirs if missing.
 *   2. Open a UUID-named temp file in the same directory, write + fsync.
 *   3. Rename (atomic on POSIX) into place.
 *
 * If any step fails, the temp file is cleaned up and the target path is left
 * untouched — callers never see a half-written file.
 */
export function writeFileAtomic(
  absolutePath: string,
  content: string | Buffer,
  mode: number = FILE_MODE_CONFIG,
): void {
  const dir = dirname(absolutePath);
  const tempPath = join(dir, `${TEMP_PREFIX}${randomUUID()}`);

  let fd: number | undefined;
  try {
    mkdirSync(dir, { recursive: true });
    fd = openSync(tempPath, "w", mode);
    if (typeof content === "string") {
      writeSync(fd, content, 0, "utf-8");
    } else {
      writeSync(fd, content, 0, content.length, 0);
    }
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tempPath, absolutePath);
  } catch (error) {
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

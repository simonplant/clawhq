/**
 * Mode-enforcing filesystem helpers.
 *
 * The Node `mode` option on `writeFile`/`appendFile` is only honored when the
 * file is *created*. If a file already exists, `mode` is silently ignored and
 * whatever mode the file has on disk is kept. Umask flips, external edits, or
 * a prior process running with a different umask can leave secret files
 * world-readable — no error, no warning.
 *
 * The functions here always `chmodSync` after the write so the file lands at
 * the intended mode regardless of prior state. Use `writeSecretFile` for
 * full rewrites, and the ensured-path set pattern in `markSecretAppend` for
 * append paths where we don't want to chmod on every line.
 */

import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { DIR_MODE_SECRET, FILE_MODE_SECRET } from "../config/defaults.js";

/**
 * Write `content` to `path` with explicit mode enforcement.
 *
 * Equivalent to `writeFileSync(path, content)` followed by `chmodSync(path, mode)`,
 * except that the chmod happens even when the file already existed with a
 * different mode. Creates parent directories (mode `DIR_MODE_SECRET`) if
 * missing.
 */
export function writeSecretFile(
  path: string,
  content: string | Buffer,
  mode: number = FILE_MODE_SECRET,
): void {
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE_SECRET });
  writeFileSync(path, content);
  chmodSync(path, mode);
}

/**
 * Append a line to a secret-mode log file.
 *
 * The first call for a given `path` within this process lifetime:
 *   1. ensures the parent directory exists (mode `DIR_MODE_SECRET`),
 *   2. appends the content,
 *   3. chmods the file to `mode`.
 *
 * Subsequent calls for the same path only append (the chmod cost is paid once
 * per process, not once per line). External changes to the file's mode aren't
 * re-enforced by this helper — call `writeSecretFile` instead for that.
 */
const chmoddedAppendPaths = new Set<string>();

export function appendSecretLine(
  path: string,
  line: string,
  mode: number = FILE_MODE_SECRET,
): void {
  if (!chmoddedAppendPaths.has(path)) {
    mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE_SECRET });
  }
  appendFileSync(path, line, { encoding: "utf-8" });
  if (!chmoddedAppendPaths.has(path)) {
    chmodSync(path, mode);
    chmoddedAppendPaths.add(path);
  }
}

/** For tests: reset the chmodded-paths cache. */
export function __resetSecretModeCacheForTests(): void {
  chmoddedAppendPaths.clear();
}

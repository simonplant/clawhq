/**
 * Mode-enforcing filesystem helpers.
 *
 * The Node `mode` option on `writeFile`/`appendFile` is only honored when the
 * file is *created*. If a file already exists, `mode` is silently ignored.
 * Umask flips or external edits can leave secret files world-readable with
 * no error. These helpers always `chmodSync` after the write so mode is
 * enforced regardless of prior file state.
 */

import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { DIR_MODE_SECRET, FILE_MODE_SECRET } from "../config/defaults.js";

/** Write `content` to `path` with explicit mode enforcement. */
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
 * Append a line to a secret-mode log file. Always `chmodSync`s after the
 * append — a few microseconds per call is a rounding error compared to
 * the disk write, and avoiding a per-process cache means we can't leak
 * state across tests or misbehave if someone fiddles with the file mode
 * externally.
 */
export function appendSecretLine(
  path: string,
  line: string,
  mode: number = FILE_MODE_SECRET,
): void {
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE_SECRET });
  appendFileSync(path, line, { encoding: "utf-8" });
  chmodSync(path, mode);
}

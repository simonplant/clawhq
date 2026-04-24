/**
 * Current-instance pointer — `~/.clawhq/current` holds a single line containing
 * the name or id of the instance this shell session should default to when no
 * `--agent` flag is given and no `CLAWHQ_AGENT` env var is set.
 *
 * Analogous to kubectl's `current-context` or gcloud's `active_config`. File
 * is text, not JSON, so the user can edit it by hand.
 */

import {
  chmodSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { FILE_MODE_SECRET } from "../../config/defaults.js";

import { clawhqRoot } from "./registry.js";

const POINTER_FILENAME = "current";

export function currentPointerPath(root: string = clawhqRoot()): string {
  return join(root, POINTER_FILENAME);
}

/** Read the pointer. Returns `undefined` when the file is missing, empty, or unreadable. */
export function readCurrentPointer(root: string = clawhqRoot()): string | undefined {
  const path = currentPointerPath(root);
  if (!existsSync(path)) return undefined;
  try {
    const value = readFileSync(path, "utf-8").trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Write the pointer. Caller may pass a name or id. */
export function writeCurrentPointer(value: string, root: string = clawhqRoot()): void {
  const path = currentPointerPath(root);
  writeFileSync(path, `${value.trim()}\n`, { mode: FILE_MODE_SECRET });
  chmodSync(path, FILE_MODE_SECRET);
}

/** Remove the pointer. No-op when absent. */
export function clearCurrentPointer(root: string = clawhqRoot()): void {
  const path = currentPointerPath(root);
  if (existsSync(path)) {
    rmSync(path, { force: true });
  }
}

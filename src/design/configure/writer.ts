/**
 * Bundle writer — combines the canonical atomic-write helper with the
 * canonical env-merge logic and the fresh-install protection filter.
 *
 * Individual pieces have moved up to `src/config/` so `clawhq apply` and
 * other callers can reuse them without duplicating logic. This file keeps
 * the bundle-level API (`writeBundle`, `filesForFreshInstall`) that
 * design/configure callers depend on and re-exports `writeFileAtomic` /
 * `parseEnvFile` / `WriteError` so existing import sites keep working.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Re-export the canonical helpers so the existing import surface is stable.
export { WriteError, writeFileAtomic } from "../../config/fs-atomic.js";
export { parseEnvFile } from "../../config/env-merge.js";

import { mergeEnv } from "../../config/env-merge.js";
import { writeFileAtomic } from "../../config/fs-atomic.js";

import type { FileEntry, WriteResult } from "./types.js";

/**
 * Read the existing file at `absolutePath` (if any) and merge the generated
 * .env content against it. Existing real credentials are preserved.
 */
function mergeEnvWithFile(absolutePath: string, generated: string): string {
  if (!existsSync(absolutePath)) return generated;
  let existing: string;
  try {
    existing = readFileSync(absolutePath, "utf-8");
  } catch {
    return generated;
  }
  return mergeEnv(existing, generated);
}

// ── Batch Write ──────────────────────────────────────────────────────────────

/**
 * Files that first-time install flows (init / quickstart) must NOT clobber
 * when the deploy already exists. Intentionally small — these are files
 * where a fresh bundle carries stub / default content that would replace
 * legitimate user input or runtime state:
 *
 * - `clawhq.yaml`     — user's input manifest (composition block).
 * - `cron/jobs.json`  — OpenClaw daemon's persistent job store.
 * - `engine/openclaw.json` — OpenClaw runtime config (provider routing,
 *                      channel allowlist, plugin state).
 *
 * Used by `filesForFreshInstall()` — init/quickstart wrap their bundle
 * through that filter. `clawhq apply` does NOT use the filter: apply is
 * the "regenerate from manifest" path and is supposed to rewrite these
 * files from current composition.
 *
 * `clawhq init --reset` archives the existing deploy to an attic first,
 * so the preserved paths don't exist by the time the filter runs — fresh
 * install proceeds as intended.
 */
const PRESERVE_ON_FRESH_INSTALL = new Set([
  "clawhq.yaml",
  "cron/jobs.json",
  "engine/openclaw.json",
]);

/**
 * Filter a bundle for first-time-install callers (init / quickstart).
 *
 * Drops entries whose target already exists on disk AND is in the
 * "preserve on re-init" list — protects the user from an accidental
 * re-init from replacing their composition / cron / openclaw config with
 * stubs. Apply does not use this filter — it uses the full bundle and
 * the caller's merge logic (mergeCronJobs, mergeEnv) to update files
 * safely.
 */
export function filesForFreshInstall(
  deployDir: string,
  files: readonly FileEntry[],
): readonly FileEntry[] {
  const resolvedDir = resolve(deployDir);
  return files.filter((f) => {
    if (!PRESERVE_ON_FRESH_INSTALL.has(f.relativePath)) return true;
    return !existsSync(join(resolvedDir, f.relativePath));
  });
}

/**
 * Write multiple files atomically to a deploy directory.
 *
 * Each file is written individually using the atomic pattern. If any file
 * fails, previously written files remain (they were each atomically complete).
 *
 * `.env` files merge with existing values (see mergeEnv). All other files
 * are written verbatim — if a caller needs to preserve existing files, it
 * must filter the bundle before calling (see `filesForFreshInstall`).
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
    const content = file.relativePath.endsWith(".env")
      ? mergeEnvWithFile(absolutePath, file.content)
      : file.content;
    writeFileAtomic(absolutePath, content, file.mode);
    written.push(absolutePath);
  }

  return { written, deployDir: resolvedDir };
}

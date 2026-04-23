/**
 * Attic — soft archival of an existing deployment before destructive
 * operations (init --reset, future reseed commands).
 *
 * Rather than delete, we rename the entire deployDir to a timestamped
 * sibling (`~/.clawhq.attic.YYYY-MM-DDTHH-MM-SS/`). Recovery is a single
 * `mv`. No data is destroyed until the user manually cleans the attic.
 *
 * Why not `destroy.ts`'s secure-wipe? Because destroy is for "I want
 * this gone, including the disk blocks" — compliance-grade. Attic is
 * for "I'm replacing it but want a safety net." Two different intents,
 * two different code paths.
 *
 * Not atomic across multiple deployDirs; intended for single-deployment
 * workflows. No automatic purge policy — the attic grows until the user
 * removes it. That's deliberate: `clawhq init --reset` should never
 * lose user data by accident.
 */

import { existsSync, renameSync } from "node:fs";
import { dirname, basename, join } from "node:path";

/**
 * Monotonic counter resets every time the module is loaded. Combined with
 * millisecond-resolution timestamps it gives archive-path uniqueness even when
 * a test or automation invokes `archiveDeployment` repeatedly inside the same
 * millisecond. The stamp format stays human-readable: `T...-mmm-N`.
 */
let collisionCounter = 0;

// ── Types ───────────────────────────────────────────────────────────────────

export interface ArchiveResult {
  /** Where the prior deployment was moved. Return to the caller so the
   *  CLI can print "backed up to X" before proceeding. */
  readonly archivePath: string;
}

// ── API ─────────────────────────────────────────────────────────────────────

/**
 * Return true if a deployment appears to exist at the given path. We use
 * `clawhq.yaml` as the sentinel — it's the one file every forged
 * deployment has and no other command creates unintentionally.
 */
export function deploymentExists(deployDir: string): boolean {
  return existsSync(join(deployDir, "clawhq.yaml"));
}

/**
 * Move the existing deployment aside to a timestamped sibling directory.
 *
 * @param deployDir — the deployDir to archive (typically `~/.clawhq`)
 * @returns where the archive was placed
 * @throws if renameSync fails (e.g. cross-filesystem boundary, permissions)
 */
export function archiveDeployment(deployDir: string): ArchiveResult {
  if (!existsSync(deployDir)) {
    // Nothing to archive — init will create fresh.
    return { archivePath: "" };
  }

  const parent = dirname(deployDir);
  const name = basename(deployDir);

  // Build the candidate archive path. If it already exists — two `init
  // --reset` calls inside the same millisecond, most commonly a test or an
  // automation loop — bump the counter and retry. We will never clobber a
  // prior archive.
  let archivePath = "";
  for (let attempt = 0; attempt < 10_000; attempt++) {
    const stamp = timestamp();
    archivePath = join(parent, `${name}.attic.${stamp}`);
    if (!existsSync(archivePath)) break;
    collisionCounter++;
    archivePath = "";
  }
  if (!archivePath) {
    throw new Error(
      `Could not find a free attic path under ${parent} after 10000 attempts`,
    );
  }

  // `renameSync` moves the inode — dotfiles and all children come with it,
  // no explicit recursive copy required.
  renameSync(deployDir, archivePath);
  return { archivePath };
}

/**
 * Timestamp in a filesystem-safe form:
 *   `YYYY-MM-DDTHH-MM-SS-mmm` or `YYYY-MM-DDTHH-MM-SS-mmm-N` when a prior
 *   call in the same millisecond bumped the collision counter.
 *
 * Colons replaced with dashes so paths remain portable across Windows, macOS
 * and Linux filesystems.
 */
function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const pad3 = (n: number) => String(n).padStart(3, "0");
  const base =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}` +
    `-${pad3(d.getMilliseconds())}`;
  return collisionCounter === 0 ? base : `${base}-${collisionCounter}`;
}

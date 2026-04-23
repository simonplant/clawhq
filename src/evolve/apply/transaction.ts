/**
 * Tree-scoped apply transaction.
 *
 * Wraps a set of file writes so that any failure — a mid-write I/O error,
 * or a post-write validation failure — rolls every touched path back to
 * its pre-transaction state. All-or-nothing apply semantics.
 *
 * Implementation strategy: pre-snapshot → write-through (files use
 * writeFileAtomic per-file) → post-validate. No tmp tree, no symlink
 * swap — bind mounts into the container stay stable, no disk doubling.
 * The tradeoff is we don't cover a hard crash of the clawhq process
 * mid-transaction; recovering from that needs a journal on disk, which
 * is a future enhancement.
 *
 * Scope:
 *   - Protects clawhq↔clawhq via the deploy-dir lock (src/config/lock.ts)
 *     acquired by apply() before this runs.
 *   - Does NOT protect against OpenClaw's runtime concurrently writing
 *     its own owned files (cron state, sessions) — those races need
 *     either an upstream lock PR or per-file optimistic concurrency.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { writeFileAtomic } from "../../config/fs-atomic.js";

// ── Types ───────────────────────────────────────────────────────────────────

type Kind = "absent" | "regular" | "symlink";

interface PreFileState {
  /** What kind of filesystem entry was there at transaction start. */
  readonly kind: Kind;
  /** Regular-file content; null for absent/symlink. */
  readonly content: Buffer | null;
  /** Regular-file mode (already masked to 0o777); null for absent/symlink. */
  readonly mode: number | null;
  /** Symlink target; null for absent/regular. */
  readonly linkTarget: string | null;
}

export interface Transaction {
  readonly deployDir: string;
  /** Relative paths snapshotted at begin(). */
  readonly paths: readonly string[];
  /** Roll every snapshotted path back to pre-state. Idempotent. */
  rollback(): void;
}

// ── API ─────────────────────────────────────────────────────────────────────

/**
 * Capture the pre-state of each relative path under deployDir. The returned
 * transaction can be rolled back to restore every path to this snapshot —
 * deleting files that didn't exist before, restoring content for files
 * that did.
 *
 * Snapshot is held in memory; sized by the aggregate bytes of files being
 * changed. For a typical apply that's <1 MiB across ~15 files, which is
 * fine. If a future command changes many-megabyte files inside a
 * transaction, consider streaming to a tmp dir instead.
 */
export function beginTransaction(
  deployDir: string,
  relativePaths: Iterable<string>,
): Transaction {
  const paths = [...new Set(relativePaths)].sort();
  const snapshot = new Map<string, PreFileState>();

  for (const rel of paths) {
    const abs = join(deployDir, rel);
    // `lstatSync` so we can distinguish symlinks from regular files. The
    // previous implementation used `statSync`, which follows the link — a
    // symlink pre-state was recorded as a regular file, and rollback would
    // then overwrite the symlink with a regular file instead of restoring
    // the link.
    let stat;
    try {
      stat = lstatSync(abs);
    } catch {
      snapshot.set(rel, { kind: "absent", content: null, mode: null, linkTarget: null });
      continue;
    }
    if (stat.isSymbolicLink()) {
      let target: string;
      try {
        target = readlinkSync(abs);
      } catch {
        snapshot.set(rel, { kind: "absent", content: null, mode: null, linkTarget: null });
        continue;
      }
      snapshot.set(rel, { kind: "symlink", content: null, mode: null, linkTarget: target });
      continue;
    }
    if (!stat.isFile()) {
      // Directories and specials aren't written through this transaction
      // pathway. Skip — they'll remain untouched.
      continue;
    }
    try {
      const content = readFileSync(abs);
      snapshot.set(rel, {
        kind: "regular",
        content,
        mode: stat.mode & 0o777,
        linkTarget: null,
      });
    } catch {
      snapshot.set(rel, { kind: "absent", content: null, mode: null, linkTarget: null });
    }
  }

  return {
    deployDir,
    paths: [...snapshot.keys()],
    rollback() {
      for (const [rel, state] of snapshot) {
        const abs = join(deployDir, rel);
        if (state.kind === "regular" && state.content !== null && state.mode !== null) {
          mkdirSync(dirname(abs), { recursive: true });
          // Clear anything (regular file or symlink) currently at the path
          // before re-writing. Otherwise we could overwrite a symlink's
          // target instead of the link itself.
          if (existsSync(abs)) {
            try { unlinkSync(abs); } catch { /* best effort */ }
          }
          // Pass the Buffer through; no utf-8 conversion (preserves binary).
          writeFileAtomic(abs, state.content, state.mode);
          continue;
        }
        if (state.kind === "symlink" && state.linkTarget !== null) {
          if (existsSync(abs)) {
            try { unlinkSync(abs); } catch { /* best effort */ }
          }
          try {
            mkdirSync(dirname(abs), { recursive: true });
            symlinkSync(state.linkTarget, abs);
          } catch {
            // Best-effort rollback — can't recreate the symlink on this fs
            // (Windows without permission) or the target is no longer valid.
          }
          continue;
        }
        // kind === "absent" — anything written by fn() should be deleted.
        if (existsSync(abs)) {
          try {
            unlinkSync(abs);
          } catch {
            // Best-effort rollback — if we can't delete (file locked,
            // permissions changed mid-transaction), leave it. The error
            // the caller is rolling back from is the primary signal.
          }
        }
      }
    },
  };
}

/**
 * Run `fn` under a transaction. On any thrown error, the transaction is
 * rolled back and the error is re-thrown. On success, the transaction is
 * simply discarded — the writes performed by `fn` stay in place.
 */
export async function withTransaction<T>(
  deployDir: string,
  relativePaths: Iterable<string>,
  fn: () => Promise<T>,
): Promise<T> {
  const tx = beginTransaction(deployDir, relativePaths);
  try {
    return await fn();
  } catch (err) {
    tx.rollback();
    throw err;
  }
}

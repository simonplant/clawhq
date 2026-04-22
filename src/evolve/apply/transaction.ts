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

import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { writeFileAtomic } from "../../design/configure/writer.js";

// ── Types ───────────────────────────────────────────────────────────────────

interface PreFileState {
  /** Whether the file existed before the transaction began. */
  readonly existed: boolean;
  /** File content as-of transaction start; null when existed === false. */
  readonly content: Buffer | null;
  /** File mode as-of transaction start; null when existed === false. */
  readonly mode: number | null;
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
    if (!existsSync(abs)) {
      snapshot.set(rel, { existed: false, content: null, mode: null });
      continue;
    }
    try {
      const stat = statSync(abs);
      if (!stat.isFile()) {
        // Directories and specials aren't written through this transaction
        // pathway. Skip — they'll remain untouched.
        continue;
      }
      const content = readFileSync(abs);
      snapshot.set(rel, { existed: true, content, mode: stat.mode & 0o777 });
    } catch {
      // Unreadable. Record as non-existent so rollback treats a subsequent
      // write as "did not exist before" (delete on rollback).
      snapshot.set(rel, { existed: false, content: null, mode: null });
    }
  }

  return {
    deployDir,
    paths: [...snapshot.keys()],
    rollback() {
      for (const [rel, state] of snapshot) {
        const abs = join(deployDir, rel);
        if (state.existed && state.content !== null) {
          mkdirSync(dirname(abs), { recursive: true });
          writeFileAtomic(abs, state.content.toString("utf-8"), state.mode ?? 0o600);
        } else if (existsSync(abs)) {
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

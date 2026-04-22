/**
 * Deploy-directory advisory lock.
 *
 * Serializes mutation operations (apply, doctor --fix, integrate add, skill
 * install) against other clawhq processes. Uses an exclusive-create pidfile
 * at `<deployDir>/.clawhq.lock` — portable across Linux/macOS, survives
 * SIGKILL via stale-PID detection, visible to any process with access to
 * the deployment directory.
 *
 * Scope & limits:
 *   - Serializes clawhq↔clawhq only. OpenClaw runtime doesn't acquire this
 *     lock today; runtime writes (cron state updates, session writes) can
 *     still race with clawhq writes on their shared file surface. Closing
 *     that gap requires either an upstream PR (OpenClaw's store.ts
 *     honouring the lock) or per-file atomic writes with optimistic
 *     concurrency. Both are Phase 2+ work.
 *   - The lock is *advisory*: a process that doesn't call `withDeployLock`
 *     is free to stomp on anything. Enforcement comes from every
 *     mutation-path routing through this helper — not from file permissions.
 *
 * Design notes:
 *   - O_EXCL create (`wx` flag) is atomic on POSIX and Windows; the kernel
 *     guarantees one winner per (path, inode) race.
 *   - Stale-lock detection reads the pidfile, tests `kill(pid, 0)`. If the
 *     process is gone we reclaim. Race on reclaim is avoided by the
 *     subsequent `wx` retry — only one reclaimer will succeed.
 *   - Bounded retry with jittered backoff; total wait defaults to 10s.
 *     Fails loud rather than hanging forever, so CI and interactive use
 *     both get a readable error.
 */

import { existsSync, readFileSync } from "node:fs";
import { open, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";

// ── Types ───────────────────────────────────────────────────────────────────

export interface LockOptions {
  /** Max total wait, in milliseconds. Defaults to 10s. */
  readonly timeoutMs?: number;
  /** Base retry interval in ms (jittered). Defaults to 100ms. */
  readonly retryIntervalMs?: number;
  /** Custom process-alive probe, for testability. Defaults to `kill(pid, 0)`. */
  readonly probePid?: (pid: number) => boolean;
}

export class DeployLockBusyError extends Error {
  readonly holder: LockMetadata;
  constructor(holder: LockMetadata) {
    super(
      `deploy lock held by PID ${holder.pid} on ${holder.host} since ${holder.acquiredAt} ` +
        `(${holder.command}). Wait for it to finish or kill the holder.`,
    );
    this.name = "DeployLockBusyError";
    this.holder = holder;
  }
}

interface LockMetadata {
  readonly pid: number;
  readonly host: string;
  readonly acquiredAt: string;
  readonly command: string;
}

type Release = () => Promise<void>;

// ── Constants ───────────────────────────────────────────────────────────────

const LOCK_FILENAME = ".clawhq.lock";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_INTERVAL_MS = 100;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Acquire the deploy lock, run `fn`, release the lock. The lock is
 * released on any path out of `fn` — resolved value, thrown error, both.
 *
 * Reentrant by PID: if the current process already holds the lock (via
 * an outer `withDeployLock` call), `fn` runs without re-acquiring and
 * without releasing on exit. Only the outermost caller manages the lock
 * file. This lets high-level commands (init, update) wrap their whole
 * workflow while still calling inner primitives (apply) that would
 * otherwise lock independently.
 */
export async function withDeployLock<T>(
  deployDir: string,
  fn: () => Promise<T>,
  opts: LockOptions = {},
): Promise<T> {
  const lockPath = join(deployDir, LOCK_FILENAME);
  const existing = readHolder(lockPath);
  if (existing && existing.pid === process.pid) {
    // Already held by this process — reentrant call, just run fn.
    return fn();
  }
  const release = await acquireDeployLock(deployDir, opts);
  try {
    return await fn();
  } finally {
    await release().catch(() => {
      // Best-effort release — if unlink fails (filesystem gone, already
      // deleted by a reclaimer), there's nothing useful to do.
    });
  }
}

/**
 * Low-level acquire. Returns a release callback. Prefer `withDeployLock`.
 *
 * @throws {DeployLockBusyError} if the lock is held past the timeout.
 */
export async function acquireDeployLock(
  deployDir: string,
  opts: LockOptions = {},
): Promise<Release> {
  const lockPath = join(deployDir, LOCK_FILENAME);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryMs = opts.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
  const probe = opts.probePid ?? defaultProbePid;

  const start = Date.now();
  const metadata = buildMetadata();
  const serialized = JSON.stringify(metadata, null, 2) + "\n";

  while (true) {
    try {
      const fh = await open(lockPath, "wx", 0o600);
      try {
        await fh.writeFile(serialized, "utf-8");
      } finally {
        await fh.close();
      }
      return async () => {
        await unlink(lockPath).catch(() => undefined);
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;

      // EEXIST — another process has the lock. Try to reclaim if stale.
      const holder = readHolder(lockPath);
      if (holder && !probe(holder.pid)) {
        // Stale: holder is gone. Unlink and retry. If two reclaimers race,
        // only one `wx` open will succeed on the next iteration.
        await unlink(lockPath).catch(() => undefined);
        continue;
      }

      if (Date.now() - start >= timeoutMs) {
        throw new DeployLockBusyError(holder ?? {
          pid: -1,
          host: "unknown",
          acquiredAt: new Date(0).toISOString(),
          command: "unknown",
        });
      }
      await sleep(jitter(retryMs));
    }
  }
}

// ── Internals ───────────────────────────────────────────────────────────────

function buildMetadata(): LockMetadata {
  return {
    pid: process.pid,
    host: hostname(),
    acquiredAt: new Date().toISOString(),
    command: process.argv.slice(1).join(" ") || "clawhq",
  };
}

function readHolder(lockPath: string): LockMetadata | null {
  if (!existsSync(lockPath)) return null;
  try {
    const raw = readFileSync(lockPath, "utf-8");
    const parsed = JSON.parse(raw) as LockMetadata;
    if (typeof parsed.pid === "number" && typeof parsed.host === "string") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function defaultProbePid(pid: number): boolean {
  // POSIX: `kill(pid, 0)` doesn't send a signal — it only checks the
  // process exists and is accessible. Returns true if signalable, false
  // on ESRCH (no such process). EPERM means the process exists but we
  // don't own it — still treat as alive so we don't clobber another
  // user's clawhq session.
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM") return true;
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(ms: number): number {
  return Math.floor(ms * (0.5 + Math.random()));
}

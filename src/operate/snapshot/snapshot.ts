/**
 * Deployment-tree snapshot + diff.
 *
 * Captures a hash manifest of every file under a deployment directory,
 * classifies each by owner, and diffs two manifests to report drift. The
 * point is observability: an agent corrupting a file that clawhq thinks is
 * OWNED_BY_OPENCLAW becomes invisible to the reconciler forever — unless
 * we snapshot before the agent session and diff after.
 *
 * Phase 1a scope: primitives only (takeSnapshot, diffSnapshot). No CLI
 * command wiring, no automatic pre/post-session capture — those land
 * alongside the reconciler in later phases.
 */

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import type { Owner } from "../../config/ownership.js";
import { classify } from "../../config/ownership.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface SnapshotEntry {
  /** Path relative to the snapshot root (deployDir). */
  readonly path: string;
  /** SHA-256 of file content. */
  readonly hash: string;
  /** Byte length of content. */
  readonly size: number;
  /** Ownership classification, or `null` if unclassified. */
  readonly owner: Owner | null;
}

export interface Snapshot {
  readonly deployDir: string;
  readonly takenAtMs: number;
  readonly entries: readonly SnapshotEntry[];
}

export type DiffKind = "added" | "removed" | "modified";

export interface DiffEntry {
  readonly path: string;
  readonly kind: DiffKind;
  readonly owner: Owner | null;
  /** For modified entries: previous hash. Empty for added. */
  readonly previousHash: string;
  /** For modified/added entries: current hash. Empty for removed. */
  readonly currentHash: string;
}

export interface SnapshotDiff {
  readonly entries: readonly DiffEntry[];
  /** Counts grouped by owner — quick health read for reports. */
  readonly byOwner: Readonly<Record<string, number>>;
}

export interface SnapshotOptions {
  /** Path prefixes (relative to deployDir) to exclude from the snapshot.
   *  Defaults exclude obviously-ephemeral paths to keep snapshots small
   *  and diff noise down. Callers can pass [] to capture everything. */
  readonly excludePrefixes?: readonly string[];
}

const DEFAULT_EXCLUDE_PREFIXES: readonly string[] = [
  "engine/source",          // OpenClaw source tree — enormous, rarely relevant
  "engine/node_modules",    // transitive installs
  "ops/backup/snapshots",   // don't snapshot the snapshots
  "ops/updater/rollback",   // pre-update image archives
  "media",                  // binary content, large
  "tmp",
];

// ── Primitives ──────────────────────────────────────────────────────────────

/**
 * Walk the deployment tree and build a snapshot manifest.
 *
 * Synchronous file reads (hashes) inside an async walker — simple, adequate
 * for deployment-sized trees (typically a few thousand files). If profiling
 * ever shows this as hot, lift to a streaming hash.
 */
export async function takeSnapshot(
  deployDir: string,
  options: SnapshotOptions = {},
): Promise<Snapshot> {
  const exclude = options.excludePrefixes ?? DEFAULT_EXCLUDE_PREFIXES;
  const entries: SnapshotEntry[] = [];

  await walk(deployDir, deployDir, exclude, entries);

  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return {
    deployDir,
    takenAtMs: Date.now(),
    entries,
  };
}

async function walk(
  root: string,
  dir: string,
  exclude: readonly string[],
  out: SnapshotEntry[],
): Promise<void> {
  let dirents;
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const dirent of dirents) {
    const abs = join(dir, dirent.name);
    const rel = relative(root, abs).replaceAll("\\", "/");

    if (isExcluded(rel, exclude)) continue;
    // Skip symlinks — snapshotting link targets is out of scope.
    if (dirent.isSymbolicLink()) continue;

    if (dirent.isDirectory()) {
      await walk(root, abs, exclude, out);
      continue;
    }
    if (!dirent.isFile()) continue;

    let size = 0;
    let hash = "";
    try {
      const content = readFileSync(abs);
      size = content.byteLength;
      hash = createHash("sha256").update(content).digest("hex");
    } catch {
      // Unreadable file — record with empty hash rather than fail the walk.
      try {
        size = statSync(abs).size;
      } catch {
        size = 0;
      }
    }

    out.push({
      path: rel,
      hash,
      size,
      owner: classify(rel),
    });
  }
}

function isExcluded(relPath: string, prefixes: readonly string[]): boolean {
  for (const prefix of prefixes) {
    if (relPath === prefix || relPath.startsWith(prefix + "/")) return true;
  }
  return false;
}

/**
 * Compare two snapshots and return changes, grouped by owner.
 *
 * The typical caller: snapshot before + after an agent session, diff to
 * see which files the agent/runtime touched. A clawhq-owned file changing
 * between snapshots (outside an `apply`) is a drift signal.
 */
export function diffSnapshot(
  before: Snapshot,
  after: Snapshot,
): SnapshotDiff {
  const beforeByPath = new Map<string, SnapshotEntry>(
    before.entries.map((e) => [e.path, e]),
  );
  const afterByPath = new Map<string, SnapshotEntry>(
    after.entries.map((e) => [e.path, e]),
  );

  const out: DiffEntry[] = [];

  for (const [path, afterEntry] of afterByPath) {
    const beforeEntry = beforeByPath.get(path);
    if (!beforeEntry) {
      out.push({
        path,
        kind: "added",
        owner: afterEntry.owner,
        previousHash: "",
        currentHash: afterEntry.hash,
      });
    } else if (beforeEntry.hash !== afterEntry.hash) {
      out.push({
        path,
        kind: "modified",
        owner: afterEntry.owner,
        previousHash: beforeEntry.hash,
        currentHash: afterEntry.hash,
      });
    }
  }

  for (const [path, beforeEntry] of beforeByPath) {
    if (!afterByPath.has(path)) {
      out.push({
        path,
        kind: "removed",
        owner: beforeEntry.owner,
        previousHash: beforeEntry.hash,
        currentHash: "",
      });
    }
  }

  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const byOwner: Record<string, number> = {};
  for (const entry of out) {
    const key = entry.owner ?? "unclassified";
    byOwner[key] = (byOwner[key] ?? 0) + 1;
  }

  return { entries: out, byOwner };
}

/**
 * Return the subset of snapshot entries that have no ownership
 * classification. Used by the `deploy-unclassified` doctor check to surface
 * files the ownership table doesn't know about — each is a future-bug
 * candidate or a missing rule.
 */
export function unclassifiedEntries(snapshot: Snapshot): readonly SnapshotEntry[] {
  return snapshot.entries.filter((e) => e.owner === null);
}

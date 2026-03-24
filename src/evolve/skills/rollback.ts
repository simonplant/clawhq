/**
 * Rollback snapshots for skill installation.
 *
 * Before every skill install, we snapshot the current workspace/skills/
 * directory. If the skill breaks the agent or fails vetting, the previous
 * state is restored from the snapshot.
 *
 * Snapshots are stored at `~/.clawhq/ops/rollback/skills/`.
 */

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { DIR_MODE_SECRET } from "../../config/defaults.js";

import type { RollbackSnapshot } from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const ROLLBACK_DIR = "ops/rollback/skills";
const MANIFEST_FILE = "snapshots.json";
const MAX_SNAPSHOTS = 10;

// ── Helpers ──────────────────────────────────────────────────────────────────

function rollbackDir(deployDir: string): string {
  return join(deployDir, ROLLBACK_DIR);
}

function manifestPath(deployDir: string): string {
  return join(rollbackDir(deployDir), MANIFEST_FILE);
}

async function loadSnapshots(deployDir: string): Promise<RollbackSnapshot[]> {
  const path = manifestPath(deployDir);
  if (!existsSync(path)) return [];
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as RollbackSnapshot[];
  } catch (err) {
    console.warn("[evolve] Failed to read rollback snapshots:", err);
    return [];
  }
}

async function saveSnapshots(
  deployDir: string,
  snapshots: RollbackSnapshot[],
): Promise<void> {
  const dir = rollbackDir(deployDir);
  mkdirSync(dir, { recursive: true, mode: DIR_MODE_SECRET });
  chmodSync(dir, DIR_MODE_SECRET);
  await writeFile(manifestPath(deployDir), JSON.stringify(snapshots, null, 2));
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a rollback snapshot of the current skills directory.
 *
 * Copies the entire workspace/skills/ to a timestamped snapshot directory.
 * Maintains a maximum of MAX_SNAPSHOTS, pruning oldest.
 */
export async function createSnapshot(
  deployDir: string,
  reason: string,
): Promise<RollbackSnapshot> {
  const id = `snap-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const snapshotPath = join(rollbackDir(deployDir), id);
  const skillsDir = join(deployDir, "workspace", "skills");

  mkdirSync(snapshotPath, { recursive: true, mode: DIR_MODE_SECRET });
  chmodSync(snapshotPath, DIR_MODE_SECRET);

  // Copy current skills directory (if it exists and has content)
  if (existsSync(skillsDir) && readdirSync(skillsDir).length > 0) {
    await cp(skillsDir, snapshotPath, { recursive: true });
  }

  const snapshot: RollbackSnapshot = {
    id,
    createdAt: new Date().toISOString(),
    reason,
    path: snapshotPath,
  };

  // Update manifest
  const snapshots = await loadSnapshots(deployDir);
  snapshots.push(snapshot);

  // Prune old snapshots beyond limit
  while (snapshots.length > MAX_SNAPSHOTS) {
    const oldest = snapshots.shift();
    if (oldest && existsSync(oldest.path)) {
      await rm(oldest.path, { recursive: true, force: true });
    }
  }

  await saveSnapshots(deployDir, snapshots);
  return snapshot;
}

/**
 * Restore the skills directory from a specific snapshot.
 *
 * Replaces the current workspace/skills/ with the snapshot contents.
 */
export async function restoreSnapshot(
  deployDir: string,
  snapshotId: string,
): Promise<{ success: boolean; error?: string }> {
  const snapshots = await loadSnapshots(deployDir);
  const snapshot = snapshots.find((s) => s.id === snapshotId);

  if (!snapshot) {
    return { success: false, error: `Snapshot "${snapshotId}" not found.` };
  }

  if (!existsSync(snapshot.path)) {
    return { success: false, error: `Snapshot directory missing: ${snapshot.path}` };
  }

  const skillsDir = join(deployDir, "workspace", "skills");

  // Remove current skills directory
  if (existsSync(skillsDir)) {
    await rm(skillsDir, { recursive: true, force: true });
  }

  // Restore from snapshot
  await cp(snapshot.path, skillsDir, { recursive: true });

  return { success: true };
}

/**
 * Restore from the most recent snapshot.
 */
export async function restoreLatestSnapshot(
  deployDir: string,
): Promise<{ success: boolean; snapshotId?: string; error?: string }> {
  const snapshots = await loadSnapshots(deployDir);
  if (snapshots.length === 0) {
    return { success: false, error: "No rollback snapshots available." };
  }

  const latest = snapshots[snapshots.length - 1];
  const result = await restoreSnapshot(deployDir, latest.id);
  return { ...result, snapshotId: latest.id };
}

/**
 * List all available rollback snapshots.
 */
export async function listSnapshots(
  deployDir: string,
): Promise<readonly RollbackSnapshot[]> {
  return loadSnapshots(deployDir);
}

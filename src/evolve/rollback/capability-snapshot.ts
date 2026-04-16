/**
 * Generic capability rollback snapshots.
 *
 * Before every capability change (integration, provider, role, or skill),
 * a snapshot is taken of the relevant state. If the change breaks something,
 * the previous state is restored from the snapshot.
 *
 * Snapshots are stored at `~/.clawhq/ops/rollback/{kind}/`.
 *
 * Each kind snapshots its own state:
 * - skills: workspace/skills/ directory
 * - integrations: manifest + credentials.json
 * - providers: manifest + engine/.env (provider keys)
 * - roles: manifest
 */

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { DIR_MODE_SECRET, FILE_MODE_SECRET } from "../../config/defaults.js";

import type { CapabilityKind, CapabilitySnapshot, RestoreResult } from "./types.js";


// ── Constants ────────────────────────────────────────────────────────────────

const ROLLBACK_BASE = "ops/rollback";
const MANIFEST_FILE = "snapshots.json";
const MAX_SNAPSHOTS = 10;

/**
 * Map of capability kind → files/dirs to snapshot.
 *
 * Paths are relative to the deployment directory.
 */
const SNAPSHOT_TARGETS: Record<CapabilityKind, readonly string[]> = {
  skills: ["workspace/skills"],
  integrations: [
    "ops/integrations/.integration-manifest.json",
    "engine/credentials.json",
  ],
  providers: [
    "ops/providers/.provider-manifest.json",
  ],
  roles: [
    "ops/roles/.role-manifest.json",
  ],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function rollbackDir(deployDir: string, kind: CapabilityKind): string {
  return join(deployDir, ROLLBACK_BASE, kind);
}

function manifestPath(deployDir: string, kind: CapabilityKind): string {
  return join(rollbackDir(deployDir, kind), MANIFEST_FILE);
}

async function loadSnapshots(
  deployDir: string,
  kind: CapabilityKind,
): Promise<CapabilitySnapshot[]> {
  const path = manifestPath(deployDir, kind);
  if (!existsSync(path)) return [];
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as CapabilitySnapshot[];
  } catch {
    return [];
  }
}

async function saveSnapshots(
  deployDir: string,
  kind: CapabilityKind,
  snapshots: CapabilitySnapshot[],
): Promise<void> {
  const dir = rollbackDir(deployDir, kind);
  mkdirSync(dir, { recursive: true, mode: DIR_MODE_SECRET });
  await writeFile(manifestPath(deployDir, kind), JSON.stringify(snapshots, null, 2), { mode: FILE_MODE_SECRET });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a rollback snapshot before a capability change.
 *
 * Copies all relevant files/directories for the given capability kind
 * into a timestamped snapshot directory. Maintains MAX_SNAPSHOTS,
 * pruning oldest.
 */
export async function createCapabilitySnapshot(
  deployDir: string,
  kind: CapabilityKind,
  reason: string,
): Promise<CapabilitySnapshot> {
  const id = `snap-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const snapshotDir = join(rollbackDir(deployDir, kind), id);
  mkdirSync(snapshotDir, { recursive: true, mode: DIR_MODE_SECRET });

  const targets = SNAPSHOT_TARGETS[kind];

  for (const target of targets) {
    const sourcePath = join(deployDir, target);
    if (!existsSync(sourcePath)) continue;

    // Determine destination — preserve the relative path structure
    const destPath = join(snapshotDir, target);
    const destDir = join(destPath, "..");
    mkdirSync(destDir, { recursive: true, mode: DIR_MODE_SECRET });

    if (statSync(sourcePath).isDirectory()) {
      if (readdirSync(sourcePath).length > 0) {
        await cp(sourcePath, destPath, { recursive: true });
      }
    } else {
      const content = readFileSync(sourcePath, "utf-8");
      writeFileSync(destPath, content, { encoding: "utf-8", mode: FILE_MODE_SECRET });
      chmodSync(destPath, FILE_MODE_SECRET);
    }
  }

  const snapshot: CapabilitySnapshot = {
    id,
    createdAt: new Date().toISOString(),
    kind,
    reason,
    path: snapshotDir,
  };

  const snapshots = await loadSnapshots(deployDir, kind);
  snapshots.push(snapshot);

  // Prune old snapshots beyond limit
  while (snapshots.length > MAX_SNAPSHOTS) {
    const oldest = snapshots.shift();
    if (oldest && existsSync(oldest.path)) {
      await rm(oldest.path, { recursive: true, force: true });
    }
  }

  await saveSnapshots(deployDir, kind, snapshots);
  return snapshot;
}

/**
 * Restore capability state from a specific snapshot.
 *
 * Replaces current state files with the snapshot contents.
 */
export async function restoreCapabilitySnapshot(
  deployDir: string,
  kind: CapabilityKind,
  snapshotId: string,
): Promise<RestoreResult> {
  const snapshots = await loadSnapshots(deployDir, kind);
  const snapshot = snapshots.find((s) => s.id === snapshotId);

  if (!snapshot) {
    return { success: false, error: `Snapshot "${snapshotId}" not found.` };
  }

  if (!existsSync(snapshot.path)) {
    return { success: false, error: `Snapshot directory missing: ${snapshot.path}` };
  }

  const targets = SNAPSHOT_TARGETS[kind];

  for (const target of targets) {
    const currentPath = join(deployDir, target);
    const snapshotPath = join(snapshot.path, target);

    // Remove current state
    if (existsSync(currentPath)) {
      await rm(currentPath, { recursive: true, force: true });
    }

    // Restore from snapshot (if the snapshot has this file/dir)
    if (existsSync(snapshotPath)) {
      const destDir = join(currentPath, "..");
      mkdirSync(destDir, { recursive: true, mode: DIR_MODE_SECRET });
      chmodSync(destDir, DIR_MODE_SECRET);
      await cp(snapshotPath, currentPath, { recursive: true });
    }
  }

  return { success: true, snapshotId };
}

/**
 * Restore from the most recent snapshot for a capability kind.
 */
export async function restoreLatestCapabilitySnapshot(
  deployDir: string,
  kind: CapabilityKind,
): Promise<RestoreResult> {
  const snapshots = await loadSnapshots(deployDir, kind);
  if (snapshots.length === 0) {
    return { success: false, error: `No rollback snapshots available for ${kind}.` };
  }

  const latest = snapshots[snapshots.length - 1];
  return restoreCapabilitySnapshot(deployDir, kind, latest.id);
}

/**
 * List all available rollback snapshots for a capability kind.
 */
export async function listCapabilitySnapshots(
  deployDir: string,
  kind: CapabilityKind,
): Promise<readonly CapabilitySnapshot[]> {
  return loadSnapshots(deployDir, kind);
}

/**
 * List all rollback snapshots across all capability kinds.
 */
export async function listAllCapabilitySnapshots(
  deployDir: string,
): Promise<readonly CapabilitySnapshot[]> {
  const kinds: CapabilityKind[] = ["skills", "integrations", "providers", "roles"];
  const all: CapabilitySnapshot[] = [];
  for (const kind of kinds) {
    const snapshots = await loadSnapshots(deployDir, kind);
    all.push(...snapshots);
  }
  // Sort by creation time
  all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return all;
}

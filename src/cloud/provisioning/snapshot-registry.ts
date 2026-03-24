/**
 * Snapshot registry — tracks pre-built VM snapshots in ~/.clawhq/cloud/snapshots.json.
 *
 * Follows the same atomic-write pattern as the instance registry.
 * Each snapshot records its provider, region, clawhq version, and build timestamp.
 * Used by the provisioning engine to boot VMs from golden images instead of cloud-init.
 */

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { DIR_MODE_SECRET, FILE_MODE_SECRET } from "../../config/defaults.js";
import type { CloudProvider, SnapshotRecord, SnapshotRegistry } from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const SNAPSHOTS_FILE = "snapshots.json";

// ── Path ────────────────────────────────────────────────────────────────────

/** Resolve snapshots.json path for a deployment directory. */
export function snapshotRegistryPath(deployDir: string): string {
  return join(deployDir, "cloud", SNAPSHOTS_FILE);
}

// ── Read ────────────────────────────────────────────────────────────────────

/** Read the snapshot registry. Returns empty registry if file doesn't exist. */
export function readSnapshotRegistry(deployDir: string): SnapshotRegistry {
  const path = snapshotRegistryPath(deployDir);
  if (!existsSync(path)) {
    return { version: 1, snapshots: [] };
  }
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as SnapshotRegistry;
  } catch (err) {
    console.warn("[provisioning] Failed to read snapshot registry:", err);
    return { version: 1, snapshots: [] };
  }
}

// ── Write ───────────────────────────────────────────────────────────────────

/** Write the snapshot registry atomically. */
function writeSnapshotRegistry(deployDir: string, registry: SnapshotRegistry): void {
  const path = snapshotRegistryPath(deployDir);
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: DIR_MODE_SECRET });
  }
  chmodSync(dir, DIR_MODE_SECRET);

  const content = JSON.stringify(registry, null, 2) + "\n";
  const tmpName = `.snapshots.tmp.${randomBytes(6).toString("hex")}`;
  const tmpPath = join(dir, tmpName);

  try {
    writeFileSync(tmpPath, content, { mode: FILE_MODE_SECRET });
    chmodSync(tmpPath, FILE_MODE_SECRET);
    renameSync(tmpPath, path);
  } catch (err) {
    throw new Error(
      `[provisioning] Failed to write snapshot registry: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

// ── Operations ──────────────────────────────────────────────────────────────

/** Add a snapshot to the registry. Returns the created record. */
export function addSnapshot(
  deployDir: string,
  record: SnapshotRecord,
): SnapshotRecord {
  const registry = readSnapshotRegistry(deployDir);

  const updated: SnapshotRegistry = {
    version: 1,
    snapshots: [...registry.snapshots, record],
  };

  writeSnapshotRegistry(deployDir, updated);
  return record;
}

/** Remove a snapshot from the registry by its provider-specific ID. Returns true if found. */
export function removeSnapshot(deployDir: string, snapshotId: string): boolean {
  const registry = readSnapshotRegistry(deployDir);
  const filtered = registry.snapshots.filter((s) => s.snapshotId !== snapshotId);

  if (filtered.length === registry.snapshots.length) {
    return false;
  }

  writeSnapshotRegistry(deployDir, { version: 1, snapshots: filtered });
  return true;
}

/** Find a snapshot by provider-specific ID. */
export function findSnapshot(deployDir: string, snapshotId: string): SnapshotRecord | undefined {
  const registry = readSnapshotRegistry(deployDir);
  return registry.snapshots.find((s) => s.snapshotId === snapshotId);
}

/**
 * Find the latest snapshot for a given provider and region.
 * Returns undefined if no snapshot exists for that provider/region combo.
 */
export function findLatestSnapshot(
  deployDir: string,
  provider: CloudProvider,
  region: string,
): SnapshotRecord | undefined {
  const registry = readSnapshotRegistry(deployDir);
  const matching = registry.snapshots
    .filter((s) => s.provider === provider && s.region === region)
    .sort((a, b) => b.builtAt.localeCompare(a.builtAt));
  return matching[0];
}

/**
 * Check if a snapshot is stale — i.e. its baked clawhq version doesn't match
 * the currently installed version. Returns true if rebuild is needed.
 */
export function isSnapshotStale(snapshot: SnapshotRecord, currentVersion: string): boolean {
  return snapshot.clawhqVersion !== currentVersion;
}

/**
 * Resolve ClawHQ operational metadata paths (Layer 2).
 *
 * Ops state — doctor snapshots, monitor logs, backup snapshots, audit trails,
 * updater rollback data, automation scripts — is *about* a managed agent, not
 * part of it (per [[ownership-layers]]). The canonical home is
 * `~/.clawhq/instances/<instanceId>/ops/`, not `${deployDir}/ops/`.
 *
 * This module lets every caller say `opsPath(deployDir, "firewall",
 * "allowlist.yaml")` and get the right location regardless of whether
 * this deployment has been migrated yet. The instanceId is read from the
 * deployment's `clawhq.yaml`; when absent (pre-187 install before the
 * apply-path backfill runs), the helper falls back to the legacy
 * `${deployDir}/ops/` so old data stays reachable until migration moves it.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

// ── Constants ───────────────────────────────────────────────────────────────

const CLAWHQ_ROOT_NAME = ".clawhq";
const INSTANCES_SUBDIR = "instances";
const OPS_SUBDIR = "ops";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Canonical ClawHQ root directory on this host. */
export function clawhqRootPath(): string {
  return join(homedir(), CLAWHQ_ROOT_NAME);
}

/** Per-instance Layer-2 ops root: `~/.clawhq/instances/<id>/ops/…`. */
export function instanceOpsDir(instanceId: string, ...parts: string[]): string {
  return join(clawhqRootPath(), INSTANCES_SUBDIR, instanceId, OPS_SUBDIR, ...parts);
}

/** Legacy `${deployDir}/ops/…` path. Kept for migration + fallback only. */
export function legacyOpsDir(deployDir: string, ...parts: string[]): string {
  return join(deployDir, OPS_SUBDIR, ...parts);
}

/**
 * Read `instanceId` from a deployment's `clawhq.yaml`. Returns undefined if
 * the file is missing, malformed, or has no `instanceId` top-level field.
 *
 * Synchronous by design — callers that resolve ops paths are often deep in
 * code not already structured for async I/O. The file is tiny and local.
 */
export function readInstanceIdFromDeploy(deployDir: string): string | undefined {
  const path = join(deployDir, "clawhq.yaml");
  if (!existsSync(path)) return undefined;
  try {
    const parsed = parseYaml(readFileSync(path, "utf-8")) as Record<string, unknown> | null;
    const id = parsed?.["instanceId"];
    return typeof id === "string" && id.length > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve an ops subpath for a deployment. Prefers the instance-scoped
 * Layer-2 location when the deployment's `clawhq.yaml` carries an
 * `instanceId`; otherwise falls back to the legacy path so unmigrated
 * installs keep working.
 *
 * Use this instead of `join(deployDir, "ops", ...)` at every call site.
 */
export function opsPath(deployDir: string, ...parts: string[]): string {
  const instanceId = readInstanceIdFromDeploy(deployDir);
  if (instanceId) return instanceOpsDir(instanceId, ...parts);
  return legacyOpsDir(deployDir, ...parts);
}

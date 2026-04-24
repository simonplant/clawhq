/**
 * One-shot migration from the legacy split registries to the unified registry.
 *
 * Legacy paths (both under ClawHQ root):
 *   - `cloud/fleet.json`        — `FleetRegistry`       (local deployments)
 *   - `cloud/instances.json`    — `InstanceRegistry`    (cloud VMs)
 *
 * Target path:
 *   - `instances.json`          — `InstancesRegistry`   (unified)
 *
 * Rules:
 *   - Idempotent. If the target file exists, migration is skipped
 *     (`alreadyMigrated: true`) regardless of the legacy files' state.
 *   - Cloud entries preserve their uuid; local (fleet) entries are assigned
 *     a fresh uuid.
 *   - Name collisions: cloud entries win (they have stable ids); the
 *     conflicting fleet entry is suffixed `-local-<short>` and reported.
 *   - Legacy files are renamed with `.migrated.bak` on success. Failures
 *     leave the legacy files untouched and rethrow.
 *
 * The migration reads legacy shapes from their canonical type modules; it
 * does not depend on the behaviour of the legacy registry code paths.
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";

import type { FleetRegistry } from "../fleet/types.js";
import type { InstanceRegistry as LegacyCloudRegistry, InstanceRegistryStatus } from "../provisioning/types.js";

import { addInstance, clawhqRoot, registryPath, updateInstance } from "./registry.js";
import type { InstanceStatus } from "./types.js";

// ── Constants ───────────────────────────────────────────────────────────────

const LEGACY_FLEET_RELATIVE = join("cloud", "fleet.json");
const LEGACY_CLOUD_RELATIVE = join("cloud", "instances.json");
const BACKUP_SUFFIX = ".migrated.bak";

// ── Types ───────────────────────────────────────────────────────────────────

export interface MigrationResult {
  /** True when the unified registry already existed before this call. */
  readonly alreadyMigrated: boolean;
  /** Number of entries folded in from `cloud/fleet.json`. */
  readonly migratedFleet: number;
  /** Number of entries folded in from `cloud/instances.json`. */
  readonly migratedCloud: number;
  /** Names that were suffixed to avoid collisions. */
  readonly renamedForConflict: readonly string[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function legacyFleetPath(root: string): string {
  return join(root, LEGACY_FLEET_RELATIVE);
}

function legacyCloudPath(root: string): string {
  return join(root, LEGACY_CLOUD_RELATIVE);
}

function readLegacyFleet(root: string): FleetRegistry | undefined {
  const path = legacyFleetPath(root);
  if (!existsSync(path)) return undefined;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as FleetRegistry;
    if (parsed && parsed.version === 1 && Array.isArray(parsed.agents)) {
      return parsed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function readLegacyCloud(root: string): LegacyCloudRegistry | undefined {
  const path = legacyCloudPath(root);
  if (!existsSync(path)) return undefined;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as LegacyCloudRegistry;
    if (parsed && parsed.version === 1 && Array.isArray(parsed.instances)) {
      return parsed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Legacy cloud `InstanceRegistryStatus` → unified `InstanceStatus`. */
function mapCloudStatus(s: InstanceRegistryStatus): InstanceStatus {
  switch (s) {
    case "provisioning":
      return "initialized";
    case "active":
      return "running";
    case "unhealthy":
      return "unhealthy";
    case "destroying":
      return "running";
    case "destroyed":
      return "destroyed";
    case "error":
      return "unhealthy";
  }
}

/** Generate a short collision-avoidance suffix from an already-minted uuid. */
function shortSuffix(id: string): string {
  return id.replace(/-/g, "").slice(0, 6);
}

// ── Migration ───────────────────────────────────────────────────────────────

/**
 * Fold legacy registries into the unified registry. No-op when the unified
 * registry already exists.
 */
export function migrateLegacyRegistries(root: string = clawhqRoot()): MigrationResult {
  const targetPath = registryPath(root);

  if (existsSync(targetPath)) {
    return {
      alreadyMigrated: true,
      migratedFleet: 0,
      migratedCloud: 0,
      renamedForConflict: [],
    };
  }

  const legacyCloud = readLegacyCloud(root);
  const legacyFleet = readLegacyFleet(root);

  if (!legacyCloud && !legacyFleet) {
    return {
      alreadyMigrated: false,
      migratedFleet: 0,
      migratedCloud: 0,
      renamedForConflict: [],
    };
  }

  const takenNames = new Set<string>();
  const renamedForConflict: string[] = [];
  let migratedCloud = 0;
  let migratedFleet = 0;

  // Cloud first — those entries have stable uuids and win name collisions.
  if (legacyCloud) {
    for (const inst of legacyCloud.instances) {
      addInstance(
        {
          id: inst.id,
          name: inst.name,
          status: mapCloudStatus(inst.status),
          location: {
            kind: "cloud",
            provider: inst.provider,
            providerInstanceId: inst.providerInstanceId,
            ipAddress: inst.ipAddress,
            region: inst.region,
            size: inst.size,
            ...(inst.sshKeyPath !== undefined ? { sshKeyPath: inst.sshKeyPath } : {}),
            ...(inst.sshHostKey !== undefined ? { sshHostKey: inst.sshHostKey } : {}),
          },
        },
        root,
      );
      takenNames.add(inst.name);
      migratedCloud += 1;
    }
  }

  // Fleet second — mint uuid; rename on name collision.
  if (legacyFleet) {
    for (const agent of legacyFleet.agents) {
      const name = agent.name;
      if (takenNames.has(name)) {
        // Add with a temporary non-colliding name, then rename to the suffixed
        // form once we have the minted id to hash into the suffix.
        const placeholder = `__migrating__${randomBytes(6).toString("hex")}`;
        const added = addInstance(
          {
            name: placeholder,
            status: "initialized",
            location: { kind: "local", deployDir: agent.deployDir },
          },
          root,
        );
        const finalName = `${name}-local-${shortSuffix(added.id)}`;
        updateInstance(added.id, { name: finalName }, root);
        renamedForConflict.push(`${name} → ${finalName}`);
        takenNames.add(finalName);
        migratedFleet += 1;
        continue;
      }
      addInstance(
        {
          name,
          status: "initialized",
          location: { kind: "local", deployDir: agent.deployDir },
        },
        root,
      );
      takenNames.add(name);
      migratedFleet += 1;
    }
  }

  // Rename legacy files so a re-run is an explicit operator choice.
  if (legacyFleet) {
    const src = legacyFleetPath(root);
    renameSync(src, `${src}${BACKUP_SUFFIX}`);
  }
  if (legacyCloud) {
    const src = legacyCloudPath(root);
    renameSync(src, `${src}${BACKUP_SUFFIX}`);
  }

  return {
    alreadyMigrated: false,
    migratedFleet,
    migratedCloud,
    renamedForConflict,
  };
}

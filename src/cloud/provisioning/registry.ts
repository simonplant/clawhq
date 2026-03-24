/**
 * Instance registry — tracks provisioned VMs in ~/.clawhq/cloud/instances.json.
 *
 * Atomic writes (temp + rename). Read returns empty registry on missing file.
 * Each instance has a UUID, provider details, IP, status, and timestamps.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type {
  CloudProvider,
  InstanceRegistry,
  InstanceRegistryStatus,
  ProvisionedInstance,
} from "./types.js";

import { FILE_MODE_SECRET } from "../../config/defaults.js";

// ── Constants ────────────────────────────────────────────────────────────────

const INSTANCES_FILE = "instances.json";

// ── Path ────────────────────────────────────────────────────────────────────

/** Resolve instances.json path for a deployment directory. */
export function instanceRegistryPath(deployDir: string): string {
  return join(deployDir, "cloud", INSTANCES_FILE);
}

// ── Read ────────────────────────────────────────────────────────────────────

/** Read the instance registry. Returns empty registry if file doesn't exist. */
export function readInstanceRegistry(deployDir: string): InstanceRegistry {
  const path = instanceRegistryPath(deployDir);
  if (!existsSync(path)) {
    return { version: 1, instances: [] };
  }
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as InstanceRegistry;
  } catch (err) {
    console.warn("[provisioning] Failed to read instance registry:", err);
    return { version: 1, instances: [] };
  }
}

// ── Write ───────────────────────────────────────────────────────────────────

/** Write the instance registry atomically. */
function writeInstanceRegistry(deployDir: string, registry: InstanceRegistry): void {
  const path = instanceRegistryPath(deployDir);
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const content = JSON.stringify(registry, null, 2) + "\n";
  const tmpName = `.instances.tmp.${randomBytes(6).toString("hex")}`;
  const tmpPath = join(dir, tmpName);

  try {
    writeFileSync(tmpPath, content, { mode: FILE_MODE_SECRET });
    chmodSync(tmpPath, FILE_MODE_SECRET);
    renameSync(tmpPath, path);
  } catch (err) {
    throw new Error(
      `[provisioning] Failed to write instance registry: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

// ── Operations ──────────────────────────────────────────────────────────────

/** Add a new instance to the registry. Returns the created instance. */
export function addInstance(
  deployDir: string,
  options: {
    readonly id?: string;
    readonly name: string;
    readonly provider: CloudProvider;
    readonly providerInstanceId: string;
    readonly ipAddress: string;
    readonly region: string;
    readonly size: string;
    readonly status: InstanceRegistryStatus;
    readonly sshKeyPath?: string;
  },
): ProvisionedInstance {
  const registry = readInstanceRegistry(deployDir);
  const now = new Date().toISOString();

  const instance: ProvisionedInstance = {
    id: options.id ?? randomUUID(),
    name: options.name,
    provider: options.provider,
    providerInstanceId: options.providerInstanceId,
    ipAddress: options.ipAddress,
    region: options.region,
    size: options.size,
    status: options.status,
    ...(options.sshKeyPath !== undefined ? { sshKeyPath: options.sshKeyPath } : {}),
    createdAt: now,
    updatedAt: now,
  };

  const updated: InstanceRegistry = {
    version: 1,
    instances: [...registry.instances, instance],
  };

  writeInstanceRegistry(deployDir, updated);
  return instance;
}

/** Update the status of an instance. Returns the updated instance or undefined. */
export function updateInstanceStatus(
  deployDir: string,
  instanceId: string,
  status: InstanceRegistryStatus,
  ipAddress?: string,
): ProvisionedInstance | undefined {
  const registry = readInstanceRegistry(deployDir);
  const now = new Date().toISOString();

  let found: ProvisionedInstance | undefined;
  const updated: ProvisionedInstance[] = registry.instances.map((inst) => {
    if (inst.id === instanceId) {
      found = {
        ...inst,
        status,
        ipAddress: ipAddress ?? inst.ipAddress,
        updatedAt: now,
      };
      return found;
    }
    return inst;
  });

  if (found) {
    writeInstanceRegistry(deployDir, { version: 1, instances: updated });
  }

  return found;
}

/** Remove an instance from the registry. Returns true if found and removed. */
export function removeInstance(deployDir: string, instanceId: string): boolean {
  const registry = readInstanceRegistry(deployDir);
  const filtered = registry.instances.filter((inst) => inst.id !== instanceId);

  if (filtered.length === registry.instances.length) {
    return false;
  }

  writeInstanceRegistry(deployDir, { version: 1, instances: filtered });
  return true;
}

/** Find an instance by ID. */
export function findInstance(deployDir: string, instanceId: string): ProvisionedInstance | undefined {
  const registry = readInstanceRegistry(deployDir);
  return registry.instances.find((inst) => inst.id === instanceId);
}

/** Find an instance by name. */
export function findInstanceByName(deployDir: string, name: string): ProvisionedInstance | undefined {
  const registry = readInstanceRegistry(deployDir);
  return registry.instances.find((inst) => inst.name === name);
}

/**
 * Unified instance registry — atomic read/write at `~/.clawhq/instances.json`.
 *
 * One machine-global file. Every OpenClaw instance ClawHQ manages (local
 * or cloud) has exactly one entry. Keyed by stable uuid; name is an alias.
 *
 * Atomic write via temp-file + rename; mode 0600 on both the file and its
 * parent directory. Missing file reads as empty registry. Unknown fields
 * in the persisted JSON are tolerated and round-trip silently discarded —
 * callers must not depend on extra fields surviving.
 *
 * This module is deliberately decoupled from the legacy FleetRegistry +
 * ProvisionedInstance registries. Migration folds those in via FEAT-187;
 * until then, this file is only written by explicit callers.
 */

import { randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { DIR_MODE_SECRET, FILE_MODE_SECRET } from "../../config/defaults.js";

import {
  AmbiguousInstancePrefixError,
  DuplicateInstanceNameError,
  type AddInstanceOptions,
  type Instance,
  type InstancesRegistry,
  type UpdateInstanceOptions,
} from "./types.js";

// ── Constants ───────────────────────────────────────────────────────────────

const REGISTRY_FILENAME = "instances.json";

/** Minimum id-prefix length accepted by `findByIdPrefix` — shorter prefixes return undefined. */
const MIN_ID_PREFIX_LENGTH = 4;

// ── Path ────────────────────────────────────────────────────────────────────

/** Root directory for ClawHQ Layer 2 state: `~/.clawhq/`. */
export function clawhqRoot(): string {
  return join(homedir(), ".clawhq");
}

/** Resolve the path to the unified registry file. */
export function registryPath(root: string = clawhqRoot()): string {
  return join(root, REGISTRY_FILENAME);
}

// ── Read ────────────────────────────────────────────────────────────────────

/** Read the registry. Returns an empty registry when the file does not exist or is malformed. */
export function readRegistry(root: string = clawhqRoot()): InstancesRegistry {
  const path = registryPath(root);
  if (!existsSync(path)) {
    return { version: 1, instances: [] };
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as InstancesRegistry;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.instances)) {
      return { version: 1, instances: [] };
    }
    return parsed;
  } catch {
    return { version: 1, instances: [] };
  }
}

// ── Write ───────────────────────────────────────────────────────────────────

/** Atomic write: mkdir -p, write temp, chmod, rename over target. */
function writeRegistry(root: string, registry: InstancesRegistry): void {
  const path = registryPath(root);
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: DIR_MODE_SECRET });
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
      `[instances] failed to write registry at ${path}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

// ── Mutations ───────────────────────────────────────────────────────────────

/**
 * Add a new instance. Mints a uuid if one is not supplied. Rejects duplicate
 * names (two instances with the same `name` would make `--agent` ambiguous).
 */
export function addInstance(
  options: AddInstanceOptions,
  root: string = clawhqRoot(),
): Instance {
  const registry = readRegistry(root);

  const nameCollision = registry.instances.find((i) => i.name === options.name);
  if (nameCollision) {
    throw new DuplicateInstanceNameError(options.name);
  }

  const now = new Date().toISOString();
  const instance: Instance = {
    id: options.id ?? randomUUID(),
    name: options.name,
    createdAt: now,
    updatedAt: now,
    status: options.status,
    ...(options.blueprint !== undefined ? { blueprint: options.blueprint } : {}),
    location: options.location,
  };

  writeRegistry(root, {
    version: 1,
    instances: [...registry.instances, instance],
  });

  return instance;
}

/**
 * Apply partial updates to an existing instance. Returns the updated record,
 * or `undefined` when the id is not present. `updatedAt` is refreshed.
 *
 * Name changes are rejected if they would collide with another instance.
 */
export function updateInstance(
  id: string,
  patch: UpdateInstanceOptions,
  root: string = clawhqRoot(),
): Instance | undefined {
  const registry = readRegistry(root);
  const existing = registry.instances.find((i) => i.id === id);
  if (!existing) return undefined;

  if (patch.name !== undefined && patch.name !== existing.name) {
    const collision = registry.instances.find((i) => i.id !== id && i.name === patch.name);
    if (collision) {
      throw new DuplicateInstanceNameError(patch.name);
    }
  }

  const now = new Date().toISOString();
  const updated: Instance = {
    ...existing,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.blueprint !== undefined ? { blueprint: patch.blueprint } : {}),
    ...(patch.location !== undefined ? { location: patch.location } : {}),
    updatedAt: now,
  };

  writeRegistry(root, {
    version: 1,
    instances: registry.instances.map((i) => (i.id === id ? updated : i)),
  });

  return updated;
}

/** Remove an instance by id. Returns true if something was removed. */
export function removeInstance(id: string, root: string = clawhqRoot()): boolean {
  const registry = readRegistry(root);
  const filtered = registry.instances.filter((i) => i.id !== id);
  if (filtered.length === registry.instances.length) return false;

  writeRegistry(root, { version: 1, instances: filtered });
  return true;
}

// ── Queries ─────────────────────────────────────────────────────────────────

/** List every registered instance in insertion order. */
export function listInstances(root: string = clawhqRoot()): readonly Instance[] {
  return readRegistry(root).instances;
}

/** Find an instance by exact id. */
export function findById(id: string, root: string = clawhqRoot()): Instance | undefined {
  return readRegistry(root).instances.find((i) => i.id === id);
}

/** Find an instance by exact name. */
export function findByName(name: string, root: string = clawhqRoot()): Instance | undefined {
  return readRegistry(root).instances.find((i) => i.name === name);
}

/**
 * Find an instance by id prefix. Returns `undefined` when:
 *   - the prefix is shorter than `MIN_ID_PREFIX_LENGTH` (prevents typo disasters),
 *   - no instance matches,
 *   - more than one instance matches — throws `AmbiguousInstancePrefixError`.
 */
export function findByIdPrefix(
  prefix: string,
  root: string = clawhqRoot(),
): Instance | undefined {
  if (prefix.length < MIN_ID_PREFIX_LENGTH) return undefined;
  const matches = readRegistry(root).instances.filter((i) => i.id.startsWith(prefix));
  if (matches.length === 0) return undefined;
  if (matches.length > 1) {
    throw new AmbiguousInstancePrefixError(prefix, matches.length);
  }
  return matches[0];
}

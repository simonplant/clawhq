/**
 * Role manifest I/O.
 *
 * Stores role definitions and assignments in ~/.clawhq/ops/roles/.role-manifest.json.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DIR_MODE_SECRET, FILE_MODE_SECRET } from "../../config/defaults.js";

import type { RoleDefinition, RoleManifest } from "./types.js";

const MANIFEST_DIR = "ops/roles";
const MANIFEST_FILE = ".role-manifest.json";

/** Built-in roles that ship with ClawHQ. */
const BUILTIN_ROLES: RoleDefinition[] = [
  {
    name: "reader",
    description: "Read-only access — can receive data but cannot send or execute",
    permissions: ["read", "receive"],
    categories: [],
    maxEgressDomains: 0,
    builtin: true,
  },
  {
    name: "operator",
    description: "Standard operating access — read, write, send, receive",
    permissions: ["read", "write", "send", "receive"],
    categories: [],
    maxEgressDomains: 0,
    builtin: true,
  },
  {
    name: "admin",
    description: "Full access — all permissions including execute and admin",
    permissions: ["read", "write", "execute", "send", "receive", "admin"],
    categories: [],
    maxEgressDomains: 0,
    builtin: true,
  },
];

function manifestPath(deployDir: string): string {
  return join(deployDir, MANIFEST_DIR, MANIFEST_FILE);
}

/** Load the role manifest. Seeds built-in roles if manifest doesn't exist. */
export function loadRoleManifest(deployDir: string): RoleManifest {
  const path = manifestPath(deployDir);
  if (!existsSync(path)) {
    return { version: 1, roles: [...BUILTIN_ROLES], assignments: {} };
  }
  // Parse errors throw loudly — silent empty-fallback used to wipe user-defined
  // roles and assignments on a single corrupted write.
  let parsed: Record<string, unknown>;
  try {
    const raw = readFileSync(path, "utf-8");
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `role manifest at ${path} is corrupt: ${msg}. ` +
      `Inspect the file manually; do not run \`clawhq role\` commands until this is resolved.`,
      { cause: err },
    );
  }
  if (parsed.version !== 1) {
    throw new Error(
      `Unsupported role manifest version ${String(parsed.version)} (expected 1). ` +
      `The manifest at ${path} may have been created by a newer version of ClawHQ.`,
    );
  }
  const manifest = parsed as unknown as RoleManifest;

  // Ensure built-in roles are always present
  const existingNames = new Set(manifest.roles.map((r) => r.name));
  const missingBuiltins = BUILTIN_ROLES.filter((r) => !existingNames.has(r.name));
  if (missingBuiltins.length > 0) {
    return {
      ...manifest,
      roles: [...manifest.roles, ...missingBuiltins],
    };
  }

  return manifest;
}

/** Save the role manifest. */
export function saveRoleManifest(deployDir: string, manifest: RoleManifest): void {
  const path = manifestPath(deployDir);
  try {
    mkdirSync(join(deployDir, MANIFEST_DIR), { recursive: true, mode: DIR_MODE_SECRET });
    chmodSync(join(deployDir, MANIFEST_DIR), DIR_MODE_SECRET);
    writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n", { encoding: "utf-8", mode: FILE_MODE_SECRET });
    chmodSync(path, FILE_MODE_SECRET);
  } catch (err) {
    throw new Error(`Failed to write role manifest: ${path}`, { cause: err });
  }
}

/** Add or update a role. Returns new manifest. */
export function upsertRole(
  manifest: RoleManifest,
  role: RoleDefinition,
): RoleManifest {
  const filtered = manifest.roles.filter((r) => r.name !== role.name);
  return { ...manifest, roles: [...filtered, role] };
}

/** Remove a role. Returns new manifest with the role removed and its assignments cleared. */
export function removeRole(
  manifest: RoleManifest,
  name: string,
): { manifest: RoleManifest; unassigned: string[] } {
  const unassigned: string[] = [];

  for (const [integration, role] of Object.entries(manifest.assignments)) {
    if (role === name) {
      unassigned.push(integration);
    }
  }
  const cleaned = Object.fromEntries(
    Object.entries(manifest.assignments).filter(([, role]) => role !== name),
  );

  return {
    manifest: {
      ...manifest,
      roles: manifest.roles.filter((r) => r.name !== name),
      assignments: cleaned,
    },
    unassigned,
  };
}

/** Assign a role to an integration. Returns new manifest. */
export function assignRole(
  manifest: RoleManifest,
  integrationName: string,
  roleName: string,
): RoleManifest {
  return {
    ...manifest,
    assignments: { ...manifest.assignments, [integrationName]: roleName },
  };
}

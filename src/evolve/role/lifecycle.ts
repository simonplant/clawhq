/**
 * Role lifecycle — add, remove, assign, list, check.
 *
 * Roles control what each integration can access. Built-in roles
 * (reader, operator, admin) cannot be removed.
 */

import {
  loadIntegrationManifest,
  saveIntegrationManifest,
  upsertIntegration,
} from "../integrate/manifest.js";
import { createCapabilitySnapshot } from "../rollback/capability-snapshot.js";

import {
  assignRole as assignRoleManifest,
  loadRoleManifest,
  removeRole as removeRoleManifest,
  saveRoleManifest,
  upsertRole,
} from "./manifest.js";
import type {
  Permission,
  RoleAddOptions,
  RoleAddResult,
  RoleAssignOptions,
  RoleAssignResult,
  RoleCheckOptions,
  RoleCheckResult,
  RoleListOptions,
  RoleListResult,
  RoleRemoveOptions,
  RoleRemoveResult,
} from "./types.js";

// ── Add Role ───────────────────────────────────────────────────────────────

export async function addRole(options: RoleAddOptions): Promise<RoleAddResult> {
  const { deployDir, name, description, permissions, categories, maxEgressDomains } = options;

  if (!name || name.length === 0) {
    return { success: false, roleName: name, error: "Role name is required" };
  }

  if (permissions.length === 0) {
    return { success: false, roleName: name, error: "At least one permission is required" };
  }

  const manifest = loadRoleManifest(deployDir);
  const existing = manifest.roles.find((r) => r.name === name);
  if (existing) {
    if (existing.builtin) {
      return { success: false, roleName: name, error: `Cannot modify built-in role "${name}"` };
    }
    return { success: false, roleName: name, error: `Role "${name}" already exists. Remove it first to recreate.` };
  }

  // Create rollback snapshot before making changes
  await createCapabilitySnapshot(deployDir, "roles", `pre-add: ${name}`);

  const role = {
    name,
    description,
    permissions: [...permissions],
    categories: categories ? [...categories] : [],
    maxEgressDomains: maxEgressDomains ?? 0,
    builtin: false,
  };

  const updated = upsertRole(manifest, role);
  saveRoleManifest(deployDir, updated);

  return { success: true, roleName: name };
}

// ── Remove Role ────────────────────────────────────────────────────────────

export async function removeRoleCmd(options: RoleRemoveOptions): Promise<RoleRemoveResult> {
  const { deployDir, name } = options;

  const manifest = loadRoleManifest(deployDir);
  const existing = manifest.roles.find((r) => r.name === name);

  if (!existing) {
    return { success: false, roleName: name, unassigned: [], error: `Role "${name}" does not exist.` };
  }

  if (existing.builtin) {
    return { success: false, roleName: name, unassigned: [], error: `Cannot remove built-in role "${name}".` };
  }

  // Create rollback snapshot before making changes
  await createCapabilitySnapshot(deployDir, "roles", `pre-remove: ${name}`);

  const { manifest: updated, unassigned } = removeRoleManifest(manifest, name);
  saveRoleManifest(deployDir, updated);

  return { success: true, roleName: name, unassigned };
}

// ── Assign Role ────────────────────────────────────────────────────────────

export async function assignRoleToIntegration(options: RoleAssignOptions): Promise<RoleAssignResult> {
  const { deployDir, roleName, integrationName } = options;

  const manifest = loadRoleManifest(deployDir);
  const role = manifest.roles.find((r) => r.name === roleName);
  if (!role) {
    return { success: false, roleName, integrationName, error: `Role "${roleName}" does not exist.` };
  }

  // Create rollback snapshot before making changes
  await createCapabilitySnapshot(deployDir, "roles", `pre-assign: ${roleName} → ${integrationName}`);

  // Update role manifest
  const updated = assignRoleManifest(manifest, integrationName, roleName);
  saveRoleManifest(deployDir, updated);

  // Cross-update integration manifest with role assignment
  const intManifest = loadIntegrationManifest(deployDir);
  const intEntry = intManifest.integrations.find((i) => i.name === integrationName);
  if (intEntry) {
    const updatedEntry = { ...intEntry, role: roleName };
    const updatedIntManifest = upsertIntegration(intManifest, updatedEntry);
    saveIntegrationManifest(deployDir, updatedIntManifest);
  }

  return { success: true, roleName, integrationName };
}

// ── List Roles ─────────────────────────────────────────────────────────────

export function listRoles(options: RoleListOptions): RoleListResult {
  const manifest = loadRoleManifest(options.deployDir);
  return {
    roles: manifest.roles,
    assignments: manifest.assignments,
    total: manifest.roles.length,
  };
}

// ── Check Role ─────────────────────────────────────────────────────────────

/**
 * Check what permissions an integration has based on its assigned role.
 */
export function checkRole(options: RoleCheckOptions): RoleCheckResult {
  const { deployDir, integrationName } = options;
  const manifest = loadRoleManifest(deployDir);

  const roleName = manifest.assignments[integrationName] ?? null;
  if (!roleName) {
    return {
      integrationName,
      roleName: null,
      permissions: [],
      allowed: false,
    };
  }

  const role = manifest.roles.find((r) => r.name === roleName);
  if (!role) {
    return {
      integrationName,
      roleName,
      permissions: [],
      allowed: false,
    };
  }

  return {
    integrationName,
    roleName,
    permissions: role.permissions as readonly Permission[],
    allowed: true,
  };
}

/**
 * Types for role management (identity governance).
 *
 * Roles define access boundaries — what each integration can access
 * and what actions are permitted. `clawhq role` manages role definitions
 * and assignments.
 *
 * Lifecycle: define role → assign to integrations → enforce at runtime.
 */

// ── Role Definitions ───────────────────────────────────────────────────────

/** A permission that can be granted by a role. */
export type Permission =
  | "read"
  | "write"
  | "execute"
  | "send"
  | "receive"
  | "admin";

/** A role definition that governs integration access. */
export interface RoleDefinition {
  /** Role name (e.g., "reader", "sender", "admin"). */
  readonly name: string;
  /** Human-readable description. */
  readonly description: string;
  /** Permissions granted by this role. */
  readonly permissions: readonly Permission[];
  /** Integration categories this role applies to (empty = all). */
  readonly categories: readonly string[];
  /** Maximum egress domains allowed (0 = inherit from integration). */
  readonly maxEgressDomains: number;
  /** Whether this is a built-in role (cannot be removed). */
  readonly builtin: boolean;
}

// ── Role Manifest ──────────────────────────────────────────────────────────

/** Full role manifest file. */
export interface RoleManifest {
  readonly version: 1;
  readonly roles: RoleDefinition[];
  /** Map of integration name → assigned role name. */
  readonly assignments: Record<string, string>;
}

// ── Options / Results ──────────────────────────────────────────────────────

/** Options for adding a role. */
export interface RoleAddOptions {
  readonly deployDir: string;
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly Permission[];
  readonly categories?: readonly string[];
  readonly maxEgressDomains?: number;
}

/** Result of adding a role. */
export interface RoleAddResult {
  readonly success: boolean;
  readonly roleName: string;
  readonly error?: string;
}

/** Options for removing a role. */
export interface RoleRemoveOptions {
  readonly deployDir: string;
  readonly name: string;
}

/** Result of removing a role. */
export interface RoleRemoveResult {
  readonly success: boolean;
  readonly roleName: string;
  /** Integrations that were unassigned from this role. */
  readonly unassigned: readonly string[];
  readonly error?: string;
}

/** Options for assigning a role to an integration. */
export interface RoleAssignOptions {
  readonly deployDir: string;
  readonly roleName: string;
  readonly integrationName: string;
}

/** Result of assigning a role. */
export interface RoleAssignResult {
  readonly success: boolean;
  readonly roleName: string;
  readonly integrationName: string;
  readonly error?: string;
}

/** Options for listing roles. */
export interface RoleListOptions {
  readonly deployDir: string;
}

/** Result of listing roles. */
export interface RoleListResult {
  readonly roles: readonly RoleDefinition[];
  readonly assignments: Record<string, string>;
  readonly total: number;
}

/** Options for checking an integration's role-based access. */
export interface RoleCheckOptions {
  readonly deployDir: string;
  readonly integrationName: string;
}

/** Result of checking role-based access. */
export interface RoleCheckResult {
  readonly integrationName: string;
  readonly roleName: string | null;
  readonly permissions: readonly Permission[];
  readonly allowed: boolean;
}

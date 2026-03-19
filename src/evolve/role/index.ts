/**
 * Role module — identity governance and access control.
 *
 * Roles define what each integration can access. Built-in roles
 * (reader, operator, admin) provide sensible defaults. Custom roles
 * allow fine-grained control.
 */

// Lifecycle
export {
  addRole,
  assignRoleToIntegration,
  checkRole,
  listRoles,
  removeRoleCmd,
} from "./lifecycle.js";

// Manifest
export { loadRoleManifest } from "./manifest.js";

// List formatting
export { formatRoleCheck, formatRoleList, formatRoleListJson } from "./list.js";

// Types
export type {
  Permission,
  RoleAddOptions,
  RoleAddResult,
  RoleAssignOptions,
  RoleAssignResult,
  RoleCheckOptions,
  RoleCheckResult,
  RoleDefinition,
  RoleListOptions,
  RoleListResult,
  RoleManifest,
  RoleRemoveOptions,
  RoleRemoveResult,
} from "./types.js";

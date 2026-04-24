/**
 * Unified instance registry — one Layer 2 record per managed OpenClaw
 * instance, local or cloud.
 *
 * See knowledge/wiki/instance-registry.md for the design.
 */

export type {
  AddInstanceOptions,
  CloudInstanceLocation,
  Instance,
  InstanceLocation,
  InstanceStatus,
  InstancesRegistry,
  LocalInstanceLocation,
  UpdateInstanceOptions,
} from "./types.js";

export {
  AmbiguousInstancePrefixError,
  DuplicateInstanceNameError,
} from "./types.js";

export {
  addInstance,
  clawhqRoot,
  findById,
  findByIdPrefix,
  findByName,
  listInstances,
  readRegistry,
  registryPath,
  removeInstance,
  updateInstance,
} from "./registry.js";

export {
  clearCurrentPointer,
  currentPointerPath,
  readCurrentPointer,
  writeCurrentPointer,
} from "./pointer.js";

export type { ResolveOptions, Resolution, ResolutionSource } from "./resolver.js";
export {
  InstanceNotFoundError,
  InstanceSelectorRequiredError,
  NoInstancesRegisteredError,
  resolveInstance,
} from "./resolver.js";

export type { MigrationResult, OpsStateMigrationResult } from "./migration.js";
export { migrateLegacyRegistries, migrateOpsState } from "./migration.js";

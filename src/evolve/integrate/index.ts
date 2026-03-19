/**
 * Integration module — connect external services with live validation.
 *
 * `clawhq integrate add <name>` connects a service, stores credentials
 * in .env (mode 0600), validates the connection live, and updates
 * the integration manifest.
 */

// Lifecycle
export {
  addIntegration,
  listIntegrations,
  removeIntegrationCmd,
  testIntegration,
} from "./lifecycle.js";

// Registry
export { availableIntegrationNames, getIntegrationDef, INTEGRATION_REGISTRY } from "./registry.js";

// Manifest
export { loadIntegrationManifest } from "./manifest.js";

// Validation
export { validateIntegration } from "./validate.js";

// List formatting
export { formatIntegrationList, formatIntegrationListJson } from "./list.js";

// Types
export type {
  IntegrationAddOptions,
  IntegrationAddResult,
  IntegrationCategory,
  IntegrationDefinition,
  IntegrationEnvKey,
  IntegrationListOptions,
  IntegrationListResult,
  IntegrationManifest,
  IntegrationManifestEntry,
  IntegrationProgress,
  IntegrationProgressCallback,
  IntegrationRemoveOptions,
  IntegrationRemoveResult,
  IntegrationTestOptions,
  IntegrationTestResult,
} from "./types.js";

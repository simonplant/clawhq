/**
 * Provider management — public API.
 *
 * Manages API provider lifecycle: add credentials, list status,
 * remove providers, and test connectivity.
 */

export {
  addProvider,
  formatProviderTable,
  formatTestResult,
  getConfiguredDomains,
  listProviders,
  loadRegistry,
  removeProvider,
  saveRegistry,
  testProvider,
  validateKeyFormat,
} from "./provider.js";

export {
  findProvider,
  getProvidersByCategory,
  KNOWN_PROVIDERS,
  listKnownProviderIds,
} from "./registry.js";

export type {
  AddProviderResult,
  ProviderCategory,
  ProviderConfig,
  ProviderDefinition,
  ProviderRegistry,
  ProviderStatus,
  RemoveProviderResult,
  TestProviderResult,
} from "./types.js";

export { ProviderError } from "./types.js";

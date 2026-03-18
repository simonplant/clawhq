/**
 * Integration management — public API.
 */

export {
  addIntegration,
  checkCronDependencies,
  cleanIdentityReferences,
  formatIntegrationList,
  getConfiguredEgressDomains,
  listIntegrations,
  loadRegistry,
  removeIntegration,
  saveRegistry,
  swapIntegration,
  updateFirewallAllowlist,
} from "./lifecycle.js";

export type { IntegrateContext } from "./lifecycle.js";

export {
  findCategory,
  findProvider,
  getIntegrationEgressDomains,
  INTEGRATION_CATEGORIES,
} from "./providers.js";

export type {
  AddResult,
  ConfiguredIntegration,
  CronDependencyResult,
  IntegrationCategoryDef,
  IntegrationListEntry,
  IntegrationRegistry,
  ProviderDef,
  RemoveResult,
  SwapResult,
} from "./types.js";

export { IntegrateError } from "./types.js";

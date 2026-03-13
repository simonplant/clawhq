/**
 * Integration management — public API.
 */

export {
  addIntegration,
  formatIntegrationList,
  getConfiguredEgressDomains,
  listIntegrations,
  loadRegistry,
  removeIntegration,
  saveRegistry,
  swapIntegration,
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
  IntegrationCategoryDef,
  IntegrationListEntry,
  IntegrationRegistry,
  ProviderDef,
  RemoveResult,
  SwapResult,
} from "./types.js";

export { IntegrateError } from "./types.js";

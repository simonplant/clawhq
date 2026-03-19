/**
 * Provider module — cloud API credential routing.
 *
 * `clawhq provider add <name>` configures a model provider, validates
 * the connection, and sets up routing for task categories.
 */

// Lifecycle
export { addProvider, listProviders, removeProviderCmd } from "./lifecycle.js";

// Registry
export { availableProviderNames, getProviderDef, PROVIDER_REGISTRY } from "./registry.js";

// Manifest
export { loadProviderManifest } from "./manifest.js";

// List formatting
export { formatProviderList, formatProviderListJson } from "./list.js";

// Types
export type {
  ProviderAddOptions,
  ProviderAddResult,
  ProviderDefinition,
  ProviderListOptions,
  ProviderListResult,
  ProviderManifest,
  ProviderManifestEntry,
  ProviderProgress,
  ProviderProgressCallback,
  ProviderRemoveOptions,
  ProviderRemoveResult,
} from "./types.js";

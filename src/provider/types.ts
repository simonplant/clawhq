/**
 * Provider management types.
 *
 * Providers are API services (LLM providers, tool APIs) that the agent
 * connects to. Each provider has credentials stored in .env, domains
 * for firewall allowlisting, and a health status from credential probes.
 */

import type { CredStatus } from "../security/credentials/types.js";

/** Category of API provider. */
export type ProviderCategory = "llm" | "tool" | "messaging" | "local";

/** A known provider definition in the built-in registry. */
export interface ProviderDefinition {
  /** Machine-readable identifier (e.g. "openai", "anthropic"). */
  id: string;
  /** Human-readable display name. */
  label: string;
  /** Provider category. */
  category: ProviderCategory;
  /** Environment variable name for the API key. */
  envVar: string;
  /** API key prefix pattern for format validation (regex string). */
  keyPattern?: string;
  /** Domains that must be allowlisted in the egress firewall. */
  domains: string[];
  /** URL used to test connectivity (health probe endpoint). */
  testUrl?: string;
  /** HTTP method for the test endpoint. */
  testMethod?: "GET" | "POST";
  /** Additional headers required for the test request. */
  testHeaders?: Record<string, string>;
}

/** Status of a configured provider. */
export type ProviderStatus = "active" | "no-credential" | "failing" | "unknown";

/** A provider as configured in a deployment. */
export interface ProviderConfig {
  /** Provider identifier from the registry. */
  id: string;
  /** Display label. */
  label: string;
  /** Provider category. */
  category: ProviderCategory;
  /** Environment variable name. */
  envVar: string;
  /** Egress firewall domains. */
  domains: string[];
  /** Current status. */
  status: ProviderStatus;
  /** Credential health from last probe (if available). */
  credentialHealth?: CredStatus;
  /** ISO timestamp when provider was added. */
  addedAt: string;
}

/** Result of a provider add operation. */
export interface AddProviderResult {
  provider: ProviderConfig;
  credentialStored: boolean;
  domainsAdded: string[];
}

/** Result of a provider remove operation. */
export interface RemoveProviderResult {
  id: string;
  credentialRemoved: boolean;
  domainsRemoved: string[];
}

/** Result of a provider test operation. */
export interface TestProviderResult {
  id: string;
  label: string;
  status: CredStatus;
  message: string;
  latencyMs: number;
}

/** Persisted provider registry (stored as JSON). */
export interface ProviderRegistry {
  providers: ProviderConfig[];
}

export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

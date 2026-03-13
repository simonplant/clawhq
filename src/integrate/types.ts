/**
 * Types for integration management.
 *
 * Integrations are provider-backed services (email, calendar, tasks, etc.)
 * that the agent connects to. Each integration belongs to a category and
 * maps to workspace tools, env vars, and firewall domains.
 */

/** A provider definition within an integration category. */
export interface ProviderDef {
  provider: string;
  label: string;
  envVar: string;
  promptLabel: string;
  /** Domains to allowlist in the egress firewall for this provider. */
  egressDomains: string[];
}

/** An integration category with available providers. */
export interface IntegrationCategoryDef {
  category: string;
  label: string;
  providers: ProviderDef[];
}

/** Stored state for a configured integration. */
export interface ConfiguredIntegration {
  category: string;
  provider: string;
  envVar: string;
  /** ISO timestamp when integration was added. */
  addedAt: string;
  /** ISO timestamp of last credential health check. */
  lastCheckedAt: string | null;
}

/** Registry of all configured integrations. */
export interface IntegrationRegistry {
  integrations: ConfiguredIntegration[];
}

/** Result of an integration add operation. */
export interface AddResult {
  integration: ConfiguredIntegration;
  toolsInstalled: string[];
  egressDomainsAdded: string[];
  requiresRebuild: boolean;
}

/** Result of an integration remove operation. */
export interface RemoveResult {
  category: string;
  provider: string;
  toolsRemoved: string[];
  egressDomainsRemoved: string[];
  envVarsCleaned: string[];
}

/** Result of an integration swap operation. */
export interface SwapResult {
  category: string;
  oldProvider: string;
  newProvider: string;
  envVarsCleaned: string[];
  envVarsAdded: string[];
  egressDomainsRemoved: string[];
  egressDomainsAdded: string[];
}

/** Integration health for list display. */
export interface IntegrationListEntry {
  category: string;
  provider: string;
  status: "configured" | "missing-credential";
  credentialHealth: "valid" | "failing" | "unchecked" | "missing";
  addedAt: string;
  lastUsed: string | null;
}

/** Result of cron dependency analysis for an integration. */
export interface CronDependencyResult {
  /** Cron jobs that depend on this integration's tools. */
  dependentJobs: Array<{ id: string; task: string }>;
  /** Whether any dependent jobs are enabled. */
  hasActiveDependencies: boolean;
}

export class IntegrateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrateError";
  }
}

/**
 * Types for provider management.
 *
 * Providers are cloud AI API endpoints (Anthropic, OpenAI, Ollama, etc.)
 * that the agent routes requests to. `clawhq provider` manages credential
 * routing — which provider handles which task category.
 *
 * Lifecycle: add → store API key → validate → update manifest → update model routing config.
 */

// ── Provider Registry ──────────────────────────────────────────────────────

/** Definition of a known provider. */
export interface ProviderDefinition {
  /** Provider name (e.g., "anthropic", "openai", "ollama"). */
  readonly name: string;
  /** Human-readable label (e.g., "Anthropic Claude"). */
  readonly label: string;
  /** Short description. */
  readonly description: string;
  /** Whether this provider requires an API key. Local providers (ollama) don't. */
  readonly requiresApiKey: boolean;
  /** The .env key for the API key (if required). */
  readonly envKey?: string;
  /** API base URL for validation. */
  readonly baseUrl: string;
  /** Default model ID for this provider. */
  readonly defaultModel: string;
}

// ── Provider Manifest ──────────────────────────────────────────────────────

/** Metadata for a configured provider. */
export interface ProviderManifestEntry {
  /** Provider name. */
  readonly name: string;
  /** Whether the last validation passed. */
  readonly validated: boolean;
  /** Task categories routed to this provider. */
  readonly routeCategories: readonly string[];
  /** ISO 8601 timestamp of when it was added. */
  readonly addedAt: string;
  /** ISO 8601 timestamp of last successful validation. */
  readonly lastValidatedAt?: string;
  /** The model ID configured for this provider. */
  readonly model?: string;
}

/** Full provider manifest file. */
export interface ProviderManifest {
  readonly version: 1;
  readonly providers: ProviderManifestEntry[];
}

// ── Options / Results ──────────────────────────────────────────────────────

/** Options for adding a provider. */
export interface ProviderAddOptions {
  readonly deployDir: string;
  readonly name: string;
  /** Pre-supplied API key. Skips interactive prompts. */
  readonly apiKey?: string;
  /** Model ID override. */
  readonly model?: string;
  /** Task categories to route to this provider. */
  readonly routeCategories?: readonly string[];
  /** Skip live validation. */
  readonly skipValidation?: boolean;
  readonly onProgress?: ProviderProgressCallback;
}

/** Result of adding a provider. */
export interface ProviderAddResult {
  readonly success: boolean;
  readonly providerName: string;
  readonly validated: boolean;
  readonly error?: string;
}

/** Options for removing a provider. */
export interface ProviderRemoveOptions {
  readonly deployDir: string;
  readonly name: string;
  /** Keep env vars in .env instead of removing them. */
  readonly keepCredentials?: boolean;
}

/** Result of removing a provider. */
export interface ProviderRemoveResult {
  readonly success: boolean;
  readonly providerName: string;
  readonly error?: string;
}

/** Options for listing providers. */
export interface ProviderListOptions {
  readonly deployDir: string;
}

/** Result of listing providers. */
export interface ProviderListResult {
  readonly providers: readonly ProviderManifestEntry[];
  readonly total: number;
}

// ── Progress ───────────────────────────────────────────────────────────────

/** Progress event during provider operations. */
export interface ProviderProgress {
  readonly step: "credentials" | "validate" | "store" | "routing" | "manifest";
  readonly status: "running" | "done" | "failed" | "skipped";
  readonly message: string;
}

/** Progress callback. */
export type ProviderProgressCallback = (event: ProviderProgress) => void;

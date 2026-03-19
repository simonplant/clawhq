/**
 * Types for integration management.
 *
 * Integrations connect the agent to external services (email, calendar,
 * market data, etc.). Each integration has credential requirements and
 * a live validation probe. Managed via `clawhq integrate add/remove/list/test`.
 *
 * Lifecycle: add → collect credentials → validate live → store in .env → update manifest.
 */

// ── Integration Registry ───────────────────────────────────────────────────

/** Definition of a known integration in the registry. */
export interface IntegrationDefinition {
  /** Integration name (e.g., "email", "calendar", "anthropic"). */
  readonly name: string;
  /** Human-readable label (e.g., "Email (IMAP)"). */
  readonly label: string;
  /** Short description of what this integration provides. */
  readonly description: string;
  /** Category: "communication", "ai", "data", "productivity". */
  readonly category: IntegrationCategory;
  /** Environment variable keys required for this integration. */
  readonly envKeys: readonly IntegrationEnvKey[];
  /** Egress domains needed for firewall allowlist. */
  readonly egressDomains: readonly string[];
}

/** Category of an integration. */
export type IntegrationCategory = "communication" | "ai" | "data" | "productivity";

/** An environment variable required by an integration. */
export interface IntegrationEnvKey {
  /** The .env key name (e.g., "IMAP_HOST"). */
  readonly key: string;
  /** Human-readable label for prompts (e.g., "IMAP host"). */
  readonly label: string;
  /** Whether this is a secret (masked in output). */
  readonly secret: boolean;
  /** Optional default value. */
  readonly defaultValue?: string;
}

// ── Integration Manifest ───────────────────────────────────────────────────

/** Metadata for an installed integration. */
export interface IntegrationManifestEntry {
  /** Integration name. */
  readonly name: string;
  /** The env keys that were configured. */
  readonly envKeys: readonly string[];
  /** Whether the last validation probe passed. */
  readonly validated: boolean;
  /** ISO 8601 timestamp of when it was added. */
  readonly addedAt: string;
  /** ISO 8601 timestamp of last successful validation. */
  readonly lastValidatedAt?: string;
  /** Role that governs this integration's access (if assigned). */
  readonly role?: string;
}

/** Full integration manifest file. */
export interface IntegrationManifest {
  readonly version: 1;
  readonly integrations: IntegrationManifestEntry[];
}

// ── Options / Results ──────────────────────────────────────────────────────

/** Options for adding an integration. */
export interface IntegrationAddOptions {
  readonly deployDir: string;
  readonly name: string;
  /** Pre-supplied credential values (key→value). Skips interactive prompts. */
  readonly credentials?: Record<string, string>;
  /** Skip live validation after storing credentials. */
  readonly skipValidation?: boolean;
  readonly onProgress?: IntegrationProgressCallback;
}

/** Result of adding an integration. */
export interface IntegrationAddResult {
  readonly success: boolean;
  readonly integrationName: string;
  readonly validated: boolean;
  readonly error?: string;
}

/** Options for removing an integration. */
export interface IntegrationRemoveOptions {
  readonly deployDir: string;
  readonly name: string;
  /** Keep env vars in .env instead of removing them. */
  readonly keepCredentials?: boolean;
}

/** Result of removing an integration. */
export interface IntegrationRemoveResult {
  readonly success: boolean;
  readonly integrationName: string;
  readonly envKeysRemoved: readonly string[];
  readonly error?: string;
}

/** Options for testing an integration's credentials. */
export interface IntegrationTestOptions {
  readonly deployDir: string;
  readonly name: string;
}

/** Result of testing an integration. */
export interface IntegrationTestResult {
  readonly success: boolean;
  readonly integrationName: string;
  readonly message: string;
  readonly error?: string;
}

/** Options for listing integrations. */
export interface IntegrationListOptions {
  readonly deployDir: string;
}

/** Result of listing integrations. */
export interface IntegrationListResult {
  readonly integrations: readonly IntegrationManifestEntry[];
  readonly total: number;
}

// ── Progress ───────────────────────────────────────────────────────────────

/** Progress event during integration operations. */
export interface IntegrationProgress {
  readonly step: "credentials" | "validate" | "store" | "firewall" | "manifest";
  readonly status: "running" | "done" | "failed" | "skipped";
  readonly message: string;
}

/** Progress callback. */
export type IntegrationProgressCallback = (event: IntegrationProgress) => void;

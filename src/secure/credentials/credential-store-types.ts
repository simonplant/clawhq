/**
 * Types for the credentials.json store.
 *
 * Integration credentials live in credentials.json (mode 0600), separate from
 * system secrets in .env. Each integration's credentials are keyed by
 * integration name, making rotation independent per integration.
 */

/** A single integration's credential set. */
export interface CredentialEntry {
  /** Integration name (e.g., "email", "calendar"). */
  readonly integration: string;
  /** Key-value pairs of credentials for this integration. */
  readonly values: Readonly<Record<string, string>>;
  /** ISO 8601 timestamp of when credentials were stored. */
  readonly storedAt: string;
  /** ISO 8601 timestamp of last rotation (if rotated). */
  readonly rotatedAt?: string;
}

/** The full credentials.json file structure. */
export interface CredentialStore {
  readonly version: 1;
  readonly credentials: readonly CredentialEntry[];
}

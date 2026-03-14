/**
 * Secret entry types for the secrets lifecycle management.
 *
 * Matches the SecretEntry data model from PRODUCT.md.
 */

import type { CredStatus } from "../credentials/types.js";

export interface SecretEntry {
  /** Secret name (env var key) */
  name: string;
  /** Provider category inferred from key name patterns */
  provider_category: string;
  /** Health status from credential probes */
  health_status: CredStatus | "unknown";
  /** When the secret was first added */
  created_at: string;
  /** When the secret was last rotated (null if never rotated) */
  rotated_at: string | null;
}

export interface SecretMetadata {
  /** When the secret was first added (ISO 8601) */
  created_at: string;
  /** When the secret was last rotated (ISO 8601, null if never) */
  rotated_at: string | null;
  /** Inferred provider category */
  provider_category: string;
}

export interface MetadataFile {
  [key: string]: SecretMetadata;
}

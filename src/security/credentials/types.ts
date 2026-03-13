/**
 * Credential health probe types.
 *
 * Each provider implements the CredentialProbe interface to check
 * whether a configured credential is valid, expired, or failing.
 */

export type CredStatus = "valid" | "expired" | "failing" | "error" | "missing";

export interface CredResult {
  provider: string;
  status: CredStatus;
  message: string;
}

export interface CredentialProbe {
  /** Display name for the provider (e.g., "Anthropic") */
  provider: string;
  /** Environment variable name for the credential */
  envVar: string;
  /** Check the credential. Implementations must not throw — return error status instead. */
  check(apiKey: string): Promise<CredResult>;
}

export interface CredReport {
  results: CredResult[];
  counts: Record<CredStatus, number>;
}

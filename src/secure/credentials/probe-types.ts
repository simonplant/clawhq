/**
 * Types for credential health probes.
 *
 * Each integration (Anthropic, OpenAI, Telegram, etc.) has a probe that
 * validates its credentials are present, well-formed, and functional.
 * The probe interface is extensible — add a new probe function to cover
 * a new integration.
 */

/** Result of a single credential probe. */
export interface ProbeResult {
  /** Integration name (e.g., "Anthropic", "OpenAI", "Telegram"). */
  readonly integration: string;
  /** The env key that was checked. */
  readonly envKey: string;
  /** Whether the credential is valid and functional. */
  readonly ok: boolean;
  /** Human-readable status message. */
  readonly message: string;
  /** Actionable fix suggestion when ok is false. */
  readonly fix?: string;
}

/** Aggregate report from running all probes. */
export interface ProbeReport {
  /** Timestamp of the probe run (ISO 8601). */
  readonly timestamp: string;
  /** Individual probe results. */
  readonly results: readonly ProbeResult[];
  /** Number of probes that passed. */
  readonly passed: number;
  /** Number of probes that failed. */
  readonly failed: number;
  /** True when all probes passed. */
  readonly healthy: boolean;
}

/**
 * A credential probe function.
 *
 * Receives env values (from the .env file) and validates a specific
 * integration's credentials. Must return a ProbeResult — never throw.
 */
export type CredentialProbe = (
  env: Record<string, string>,
) => Promise<ProbeResult>;

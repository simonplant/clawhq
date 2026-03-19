/**
 * Types for backing service management.
 *
 * `clawhq service add postgres` adds a backing service container
 * alongside the OpenClaw agent. Services are configured in
 * docker-compose.yml and connected via the clawhq_net network.
 */

// ── Service Definitions ──────────────────────────────────────────────────────

/** Supported backing service names. */
export type ServiceName = "postgres" | "redis" | "qdrant";

/** Configuration for a backing service. */
export interface ServiceConfig {
  readonly name: ServiceName;
  readonly image: string;
  readonly port: number;
  readonly envVars: Record<string, string>;
  readonly volumes: readonly string[];
  readonly healthcheck: {
    readonly test: string;
    readonly interval: string;
    readonly timeout: string;
    readonly retries: number;
  };
}

// ── Service Add Options ──────────────────────────────────────────────────────

/** Options for adding a backing service. */
export interface ServiceAddOptions {
  /** Path to the deployment directory. */
  readonly deployDir: string;
  /** Service to add. */
  readonly service: ServiceName;
  /** Custom port mapping (host:container). */
  readonly port?: number;
  /** Custom environment variables to override defaults. */
  readonly envOverrides?: Record<string, string>;
}

/** Result of adding a backing service. */
export interface ServiceAddResult {
  readonly success: boolean;
  readonly service: ServiceName;
  /** Path to the updated docker-compose.yml. */
  readonly composePath?: string;
  /** Environment variables added to .env. */
  readonly envVarsAdded?: readonly string[];
  readonly error?: string;
}

/** Options for listing configured services. */
export interface ServiceListOptions {
  readonly deployDir: string;
}

/** A configured service entry. */
export interface ServiceEntry {
  readonly name: string;
  readonly image: string;
  readonly status: "configured" | "unknown";
}

/** Result of listing services. */
export interface ServiceListResult {
  readonly services: readonly ServiceEntry[];
}

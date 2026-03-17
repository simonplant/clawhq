/**
 * Server request context.
 *
 * Extends Hono's context with typed environment variables
 * shared across all routes.
 */

export interface ServerEnv {
  Variables: {
    /** Whether the request is authenticated. */
    authenticated: boolean;
  };
}

export interface ServerConfig {
  /** Port to listen on. Default: 18790. */
  port: number;
  /** Host to bind. Default: 127.0.0.1 (localhost only). */
  host: string;
  /** Bearer token for API auth. If unset, auth is disabled. */
  token?: string;
  /** OpenClaw home directory. Default: ~/.openclaw. */
  openclawHome: string;
}

const DEFAULT_PORT = 18790;
const DEFAULT_HOST = "127.0.0.1";

export function resolveConfig(overrides?: Partial<ServerConfig>): ServerConfig {
  const home = overrides?.openclawHome ?? (process.env["OPENCLAW_HOME"] || `${process.env["HOME"] ?? "/root"}/.openclaw`);
  return {
    port: overrides?.port ?? DEFAULT_PORT,
    host: overrides?.host ?? DEFAULT_HOST,
    token: overrides?.token ?? process.env["CLAWHQ_TOKEN"],
    openclawHome: home,
  };
}

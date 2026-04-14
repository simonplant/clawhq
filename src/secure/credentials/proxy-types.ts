/**
 * Types for the credential proxy — host-side token proxy so secrets
 * never enter the agent container.
 *
 * The proxy runs as a Docker sidecar on the bridge network. It receives
 * requests from tool wrappers inside the agent container, injects
 * credentials from the host-side store, and forwards to upstream APIs.
 */

// ── Auth Injection ─────────────────────────────────────────────────────────

/** Inject credential as an HTTP header (e.g. Authorization: Bearer <token>). */
export interface HeaderAuth {
  readonly type: "header";
  /** Header name (e.g. "Authorization", "x-api-key"). */
  readonly header: string;
  /** Optional prefix before the credential value (e.g. "Bearer "). */
  readonly prefix?: string;
  /** Environment variable name holding the credential. */
  readonly envVar: string;
}

/** Inject credential as a field in a JSON request body (e.g. api_key). */
export interface BodyJsonAuth {
  readonly type: "body-json-field";
  /** JSON field name to inject (e.g. "api_key"). */
  readonly field: string;
  /** Environment variable name holding the credential. */
  readonly envVar: string;
}

/** Inject multiple credentials as fields in a JSON request body (e.g. Plaid client_id + secret + access_token). */
export interface BodyJsonFieldsAuth {
  readonly type: "body-json-fields";
  /** Map of JSON field name → environment variable name. */
  readonly fields: Readonly<Record<string, string>>;
}

/** Inject HTTP Basic auth (user:pass base64-encoded). */
export interface BasicAuth {
  readonly type: "basic";
  /** Environment variable name holding the username. */
  readonly userEnvVar: string;
  /** Environment variable name holding the password. */
  readonly passEnvVar: string;
}

/** No credential injection — passthrough proxy (e.g. public APIs). */
export interface NoAuth {
  readonly type: "none";
  /**
   * Dummy envVar for filterRoutesForEnv compatibility.
   * Set to a sentinel value that always passes filtering.
   */
  readonly envVar: string;
}

/** Union of credential injection strategies. */
export type ProxyAuthConfig = HeaderAuth | BodyJsonAuth | BodyJsonFieldsAuth | BasicAuth | NoAuth;

// ── Route Definition ───────────────────────────────────────────────────────

/** A single proxy route mapping a path prefix to an upstream API with credential injection. */
export interface ProxyRoute {
  /** Unique route identifier (e.g. "tavily", "todoist"). */
  readonly id: string;
  /** Path prefix to match on incoming requests (e.g. "/tavily"). */
  readonly pathPrefix: string;
  /** Upstream base URL to forward requests to (e.g. "https://api.tavily.com"). */
  readonly upstream: string;
  /** How to inject credentials into the forwarded request. */
  readonly auth: ProxyAuthConfig;
}

// ── Routes File ────────────────────────────────────────────────────────────

/** Schema for the routes.json file read by the proxy server. */
export interface ProxyRoutesConfig {
  /** Host to bind to (default: "0.0.0.0"). */
  readonly host?: string;
  /** Port to listen on (default: CRED_PROXY_PORT). */
  readonly port?: number;
  /** Route definitions. */
  readonly routes: readonly ProxyRoute[];
}

// ── Proxy Audit Event ──────────────────────────────────────────────────────

/** Logged for every request proxied through the credential proxy. */
export interface ProxyAuditEntry {
  /** ISO 8601 timestamp. */
  readonly ts: string;
  /** Route ID that matched (e.g. "tavily"). */
  readonly routeId: string;
  /** HTTP method (GET, POST, etc.). */
  readonly method: string;
  /** Upstream URL the request was forwarded to. */
  readonly upstream: string;
  /** HTTP status code from upstream. */
  readonly statusCode: number;
  /** Duration in milliseconds. */
  readonly durationMs: number;
  /** Whether the credential was successfully injected. */
  readonly credInjected: boolean;
}

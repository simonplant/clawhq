/**
 * Credential proxy route definitions and route file generation.
 *
 * Routes map tool API calls to upstream services with credential injection.
 * The proxy reads routes.json at startup to know which paths to intercept
 * and how to inject credentials.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ProxyRoute, ProxyRoutesConfig } from "./proxy-types.js";

// ── Default Port ───────────────────────────────────────────────────────────

/** Default port for the credential proxy sidecar. */
export const CRED_PROXY_DEFAULT_PORT = 9876;

/** Default host for the credential proxy sidecar. */
export const CRED_PROXY_DEFAULT_HOST = "0.0.0.0";

/** Container hostname for the cred-proxy service on the Docker bridge. */
export const CRED_PROXY_SERVICE_NAME = "cred-proxy";

// ── Built-in Route Definitions ─────────────────────────────────────────────

/**
 * Built-in proxy routes for known integrations.
 *
 * Each route maps a tool's API calls to the upstream service and defines
 * how credentials are injected. Tool wrappers call the proxy at
 * `http://cred-proxy:9876/<pathPrefix>/...` and the proxy injects
 * the credential before forwarding.
 */
export const BUILTIN_ROUTES: readonly ProxyRoute[] = [
  {
    id: "tavily",
    pathPrefix: "/tavily",
    upstream: "https://api.tavily.com",
    auth: {
      type: "body-json-field",
      field: "api_key",
      envVar: "TAVILY_API_KEY",
    },
  },
  {
    id: "todoist",
    pathPrefix: "/todoist",
    upstream: "https://api.todoist.com/api/v1",
    auth: {
      type: "header",
      header: "Authorization",
      prefix: "Bearer ",
      envVar: "TODOIST_API_KEY",
    },
  },
  {
    id: "todoist-sync",
    pathPrefix: "/todoist-sync",
    upstream: "https://api.todoist.com/sync/v9",
    auth: {
      type: "header",
      header: "Authorization",
      prefix: "Bearer ",
      envVar: "TODOIST_API_KEY",
    },
  },
  {
    id: "anthropic",
    pathPrefix: "/anthropic",
    upstream: "https://api.anthropic.com",
    auth: {
      type: "header",
      header: "x-api-key",
      envVar: "ANTHROPIC_API_KEY",
    },
  },
  {
    id: "openai",
    pathPrefix: "/openai",
    upstream: "https://api.openai.com",
    auth: {
      type: "header",
      header: "Authorization",
      prefix: "Bearer ",
      envVar: "OPENAI_API_KEY",
    },
  },
  {
    id: "github",
    pathPrefix: "/github",
    upstream: "https://api.github.com",
    auth: {
      type: "header",
      header: "Authorization",
      prefix: "Bearer ",
      envVar: "GH_TOKEN",
    },
  },
  {
    id: "x",
    pathPrefix: "/x",
    upstream: "https://api.twitter.com",
    auth: {
      type: "header",
      header: "Authorization",
      prefix: "Bearer ",
      envVar: "X_BEARER_TOKEN",
    },
  },
  // Substack has no proxy route — each publication is a different subdomain
  // (pub.substack.com). Cookie auth is injected directly by the tool.
  {
    id: "ha",
    pathPrefix: "/ha",
    // Upstream resolved from HA_URL env var at proxy startup.
    upstream: "env:HA_URL",
    auth: {
      type: "header",
      header: "Authorization",
      prefix: "Bearer ",
      envVar: "HA_TOKEN",
    },
  },
  {
    id: "op",
    pathPrefix: "/op",
    upstream: "https://my.1password.com",
    auth: {
      type: "header",
      header: "Authorization",
      prefix: "Bearer ",
      envVar: "OP_SERVICE_ACCOUNT_TOKEN",
    },
  },
  {
    id: "yahoo",
    pathPrefix: "/yahoo",
    upstream: "https://query1.finance.yahoo.com",
    auth: {
      type: "none",
      envVar: "_ALWAYS_ENABLED",
    },
  },
  {
    id: "caldav",
    pathPrefix: "/caldav",
    // Upstream resolved from CALDAV_URL env var at proxy startup.
    upstream: "env:CALDAV_URL",
    auth: {
      type: "basic",
      userEnvVar: "CALDAV_USER",
      passEnvVar: "CALDAV_PASS",
    },
  },
  {
    id: "fastmail",
    pathPrefix: "/fastmail",
    upstream: "https://api.fastmail.com",
    auth: {
      type: "header",
      header: "Authorization",
      prefix: "Bearer ",
      envVar: "FASTMAIL_API_TOKEN",
    },
  },
  {
    id: "fastmail-dl",
    pathPrefix: "/fastmail-dl",
    upstream: "https://www.fastmailusercontent.com",
    auth: {
      type: "header",
      header: "Authorization",
      prefix: "Bearer ",
      envVar: "FASTMAIL_API_TOKEN",
    },
  },
  {
    id: "tradier",
    pathPrefix: "/tradier",
    upstream: "https://api.tradier.com",
    auth: {
      type: "header",
      header: "Authorization",
      prefix: "Bearer ",
      envVar: "TRADIER_TOKEN",
    },
  },
];

// ── Route File Generation ──────────────────────────────────────────────────

/**
 * Generate a ProxyRoutesConfig from a list of routes.
 *
 * Includes only routes whose corresponding env var is likely configured
 * (i.e. the route is relevant for this deployment).
 */
export function buildRoutesConfig(
  routes: readonly ProxyRoute[],
  port = CRED_PROXY_DEFAULT_PORT,
): ProxyRoutesConfig {
  return {
    host: CRED_PROXY_DEFAULT_HOST,
    port,
    routes,
  };
}

/**
 * Filter routes to only those whose env var is present in the given env map.
 *
 * During init, we know which env vars are set. Only generate routes
 * for integrations that have credentials configured.
 */
export function filterRoutesForEnv(
  routes: readonly ProxyRoute[],
  envVars: Record<string, string>,
): ProxyRoute[] {
  return routes.filter((r) => {
    if (r.auth.type === "none") return true;
    if (r.auth.type === "basic") return envVars[r.auth.userEnvVar] !== undefined;
    return envVars[r.auth.envVar] !== undefined;
  });
}

/**
 * Write routes.json to the deployment directory.
 *
 * Written to `{deployDir}/engine/cred-proxy-routes.json`.
 */
export async function writeRoutesConfig(
  deployDir: string,
  config: ProxyRoutesConfig,
): Promise<string> {
  const filePath = routesConfigPath(deployDir);
  await writeFile(filePath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return filePath;
}

/** Path to the routes.json file within a deployment directory. */
export function routesConfigPath(deployDir: string): string {
  return join(deployDir, "engine", "cred-proxy-routes.json");
}

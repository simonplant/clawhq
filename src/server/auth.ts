/**
 * Authentication middleware.
 *
 * Supports two auth flows:
 * 1. Bearer token in Authorization header (API clients)
 * 2. Session cookie set after initial bearer auth (browser clients)
 *
 * If no token is configured, auth is disabled (local-only use).
 */

import type { Context, Next } from "hono";
import { getCookie, setCookie } from "hono/cookie";

import type { ServerConfig, ServerEnv } from "./context.js";

const COOKIE_NAME = "clawhq_session";
const COOKIE_MAX_AGE = 86400; // 24 hours

export function authMiddleware(config: ServerConfig) {
  return async (c: Context<ServerEnv>, next: Next) => {
    // No token configured — auth disabled (localhost-only)
    if (!config.token) {
      c.set("authenticated", true);
      return next();
    }

    // Check bearer token
    const authHeader = c.req.header("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      if (token === config.token) {
        c.set("authenticated", true);
        // Set cookie so browser doesn't need to send bearer on every request
        setCookie(c, COOKIE_NAME, token, {
          httpOnly: true,
          sameSite: "Strict",
          maxAge: COOKIE_MAX_AGE,
          path: "/",
        });
        return next();
      }
    }

    // Check session cookie
    const cookie = getCookie(c, COOKIE_NAME);
    if (cookie === config.token) {
      c.set("authenticated", true);
      return next();
    }

    // Unauthenticated
    c.set("authenticated", false);
    return c.text("Unauthorized", 401);
  };
}

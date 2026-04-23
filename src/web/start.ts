/**
 * Dashboard server start — uses @hono/node-server to serve the Hono app.
 */

import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { serve } from "@hono/node-server";

import { DASHBOARD_DEFAULT_PORT, FILE_MODE_SECRET } from "../config/defaults.js";

import { createApp } from "./server.js";
import type { DashboardOptions } from "./server.js";

const DEFAULT_HOSTNAME = "localhost";

/**
 * Start the web dashboard server.
 *
 * Resolves when the server is listening. Returns a close function and the
 * generated session token. The token is also persisted to
 * `<deployDir>/ops/web/session.token` (mode 0600) so other tools on the same
 * host can read it without needing to be told.
 */
export async function startDashboard(
  options: DashboardOptions,
): Promise<{ port: number; hostname: string; sessionToken: string; close: () => void }> {
  const port = options.port ?? DASHBOARD_DEFAULT_PORT;
  const hostname = options.hostname ?? DEFAULT_HOSTNAME;
  const sessionToken = options.sessionToken ?? randomBytes(32).toString("hex");

  // Persist the token so out-of-band tooling can find it.
  const tokenPath = join(options.deployDir, "ops", "web", "session.token");
  mkdirSync(dirname(tokenPath), { recursive: true });
  writeFileSync(tokenPath, sessionToken, "utf-8");
  chmodSync(tokenPath, FILE_MODE_SECRET);

  const app = createApp({ ...options, sessionToken });

  return new Promise((resolve) => {
    const server = serve(
      { fetch: app.fetch, port, hostname },
      () => {
        resolve({
          port,
          hostname,
          sessionToken,
          close: () => { server.close(); },
        });
      },
    );
  });
}

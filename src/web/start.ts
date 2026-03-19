/**
 * Dashboard server start — uses @hono/node-server to serve the Hono app.
 */

import { serve } from "@hono/node-server";

import { createApp } from "./server.js";
import type { DashboardOptions } from "./server.js";

const DEFAULT_PORT = 3737;
const DEFAULT_HOSTNAME = "localhost";

/**
 * Start the web dashboard server.
 *
 * Resolves when the server is listening. Returns a close function.
 */
export async function startDashboard(
  options: DashboardOptions,
): Promise<{ port: number; hostname: string; close: () => void }> {
  const port = options.port ?? DEFAULT_PORT;
  const hostname = options.hostname ?? DEFAULT_HOSTNAME;
  const app = createApp(options);

  return new Promise((resolve) => {
    const server = serve(
      { fetch: app.fetch, port, hostname },
      () => {
        resolve({
          port,
          hostname,
          close: () => { server.close(); },
        });
      },
    );
  });
}

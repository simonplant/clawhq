/**
 * Web dashboard server.
 *
 * Creates and starts the Hono server with @hono/node-server.
 * Listens on localhost only — this is a local control panel.
 */

import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import type { ServerConfig } from "./context.js";
import { resolveConfig } from "./context.js";

export type { ServerConfig } from "./context.js";
export { resolveConfig } from "./context.js";
export { createApp } from "./app.js";

export interface DashboardServer {
  /** The URL the server is listening on. */
  url: string;
  /** Stop the server. */
  close: () => void;
}

/**
 * Start the web dashboard server.
 *
 * Returns a handle to close it.
 */
export function startServer(overrides?: Partial<ServerConfig>): DashboardServer {
  const config = resolveConfig(overrides);
  const app = createApp(config);

  const server = serve({
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
  });

  const url = `http://${config.host}:${config.port}`;

  return {
    url,
    close: () => {
      server.close();
    },
  };
}

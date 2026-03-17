/**
 * Server-Sent Events helpers.
 *
 * Provides SSE streaming for the dashboard status updates.
 */

import type { Context } from "hono";
import { streamSSE } from "hono/streaming";

import type { StatusReport } from "../status/index.js";
import { collectStatus } from "../status/index.js";

import type { ServerEnv } from "./context.js";

const SSE_INTERVAL_MS = 5_000;

/**
 * SSE endpoint that streams status updates every 5 seconds.
 */
export function handleStatusSSE(openclawHome: string) {
  return (c: Context<ServerEnv>) => {
    return streamSSE(c, async (stream) => {
      let id = 0;
      const abortController = new AbortController();

      // Clean up on client disconnect
      stream.onAbort(() => {
        abortController.abort();
      });

      while (!abortController.signal.aborted) {
        try {
          const report: StatusReport = await collectStatus({ openclawHome });
          await stream.writeSSE({
            data: JSON.stringify(report),
            event: "status",
            id: String(id++),
          });
        } catch {
          await stream.writeSSE({
            data: JSON.stringify({ error: "Failed to collect status" }),
            event: "error",
            id: String(id++),
          });
        }

        // Wait for interval or abort
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, SSE_INTERVAL_MS);
          abortController.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
          }, { once: true });
        });
      }
    });
  };
}

/**
 * Hono application with routes.
 *
 * Defines all web dashboard routes: pages, static assets, and SSE.
 * API endpoints are defined separately in FEAT-071.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";

import { renderHomePage } from "../ui/pages/home.js";

import { authMiddleware } from "./auth.js";
import type { ServerConfig, ServerEnv } from "./context.js";
import { handleStatusSSE } from "./sse.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp(config: ServerConfig): Hono<ServerEnv> {
  const app = new Hono<ServerEnv>();

  // --- Auth middleware (all routes) ---
  app.use("*", authMiddleware(config));

  // --- Static assets ---
  app.get("/static/:file", async (c) => {
    const fileName = c.req.param("file");
    // Only serve known static files
    const allowed = ["htmx.min.js", "pico.min.css"];
    if (!allowed.includes(fileName)) {
      return c.notFound();
    }

    const staticDir = join(__dirname, "..", "ui", "static");
    const filePath = join(staticDir, fileName);

    try {
      const content = await readFile(filePath, "utf-8");
      const contentType = fileName.endsWith(".js")
        ? "application/javascript"
        : "text/css";
      return c.body(content, 200, { "Content-Type": contentType, "Cache-Control": "public, max-age=86400" });
    } catch {
      return c.notFound();
    }
  });

  // --- SSE ---
  app.get("/sse/status", handleStatusSSE(config.openclawHome));

  // --- Pages ---
  app.get("/", (c) => {
    return c.html(renderHomePage());
  });

  return app;
}

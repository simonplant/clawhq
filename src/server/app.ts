/**
 * Hono application with routes.
 *
 * Defines all web dashboard routes: pages, static assets, SSE, and API.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";

import { renderApprovalsPage } from "../ui/pages/approvals.js";
import { renderDeployPage } from "../ui/pages/deploy.js";
import { renderDoctorPage } from "../ui/pages/doctor.js";
import { renderHomePage } from "../ui/pages/home.js";
import { renderLogsPage } from "../ui/pages/logs.js";
import { renderSkillsPage } from "../ui/pages/skills.js";

import { createApiRouter } from "./api.js";
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

  // --- API v1 ---
  app.route("/api/v1", createApiRouter(config));

  // --- SSE ---
  app.get("/sse/status", handleStatusSSE(config.openclawHome));

  // --- Pages ---
  app.get("/", (c) => {
    return c.html(renderHomePage());
  });

  app.get("/deploy", (c) => {
    return c.html(renderDeployPage());
  });

  app.get("/doctor", (c) => {
    return c.html(renderDoctorPage());
  });

  app.get("/logs", (c) => {
    return c.html(renderLogsPage());
  });

  app.get("/approvals", (c) => {
    return c.html(renderApprovalsPage());
  });

  app.get("/skills", (c) => {
    return c.html(renderSkillsPage());
  });

  return app;
}

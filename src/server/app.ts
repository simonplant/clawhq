/**
 * Hono application with routes.
 *
 * Defines all web dashboard routes: pages, static assets, SSE, and API.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";

import { renderAlertsPage } from "../ui/pages/alerts.js";
import { renderApprovalsPage } from "../ui/pages/approvals.js";
import { renderBackupsPage } from "../ui/pages/backups.js";
import { renderDeployPage } from "../ui/pages/deploy.js";
import { renderDoctorPage } from "../ui/pages/doctor.js";
import { renderFleetPage } from "../ui/pages/fleet.js";
import { renderHomePage } from "../ui/pages/home.js";
import { renderInitWizardPage } from "../ui/pages/init-wizard.js";
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

  app.get("/alerts", (c) => {
    return c.html(renderAlertsPage());
  });

  app.get("/approvals", (c) => {
    return c.html(renderApprovalsPage());
  });

  app.get("/backups", (c) => {
    return c.html(renderBackupsPage());
  });

  app.get("/skills", (c) => {
    return c.html(renderSkillsPage());
  });

  app.get("/fleet", (c) => {
    return c.html(renderFleetPage());
  });

  app.get("/init-wizard", (c) => {
    return c.html(renderInitWizardPage());
  });

  return app;
}

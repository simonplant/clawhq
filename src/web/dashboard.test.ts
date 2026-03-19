/**
 * Tests for the web dashboard — route rendering and API endpoints.
 *
 * Uses Hono's built-in test client (app.request) rather than starting
 * a real HTTP server. Verifies all 7 pages render and key API endpoints
 * return valid HTML fragments.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GATEWAY_DEFAULT_PORT } from "../config/defaults.js";
import { createApp } from "./server.js";

// ── Test Fixtures ───────────────────────────────────────────────────────────

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `clawhq-dash-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(testDir, "engine"), { recursive: true });
  await mkdir(join(testDir, "workspace", "identity"), { recursive: true });
  await mkdir(join(testDir, "workspace", "tools"), { recursive: true });
  await mkdir(join(testDir, "workspace", "skills"), { recursive: true });
  await mkdir(join(testDir, "workspace", "memory"), { recursive: true });
  await mkdir(join(testDir, "cron"), { recursive: true });

  // Minimal valid config
  await writeFile(
    join(testDir, "engine", "openclaw.json"),
    JSON.stringify({
      dangerouslyDisableDeviceAuth: true,
      allowedOrigins: [`http://localhost:${GATEWAY_DEFAULT_PORT}`],
      trustedProxies: ["172.17.0.1"],
      tools: { exec: { host: "gateway", security: "full" } },
      fs: { workspaceOnly: true },
    }, null, 2) + "\n",
  );

  // Minimal compose
  await writeFile(
    join(testDir, "engine", "docker-compose.yml"),
    "services:\n  openclaw:\n    image: openclaw:latest\n",
  );

  // Empty secrets
  await writeFile(join(testDir, "engine", ".env"), "GATEWAY_TOKEN=test\n", { mode: 0o600 });

  // Skill manifest
  await writeFile(
    join(testDir, "workspace", "skills", ".skill-manifest.json"),
    JSON.stringify({ version: 1, skills: [] }) + "\n",
  );

  // Approval queue
  await writeFile(
    join(testDir, "workspace", "memory", "approval-queue.json"),
    JSON.stringify({ version: 1, items: [] }) + "\n",
  );
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("dashboard pages", () => {
  it("renders home page", async () => {
    const app = createApp({ deployDir: testDir });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Agent Overview");
    expect(html).toContain("ClawHQ Dashboard");
    expect(html).toContain("pico");
    expect(html).toContain("htmx");
  });

  it("renders doctor page with check results", async () => {
    const app = createApp({ deployDir: testDir });
    const res = await app.request("/doctor");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Doctor Diagnostics");
    expect(html).toContain("config-exists");
  });

  it("renders logs page", async () => {
    const app = createApp({ deployDir: testDir });
    const res = await app.request("/logs");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Agent Logs");
  });

  it("renders deploy page", async () => {
    const app = createApp({ deployDir: testDir });
    const res = await app.request("/deploy");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Deploy Controls");
    expect(html).toContain("Start (up)");
    expect(html).toContain("Restart");
    expect(html).toContain("Stop (down)");
  });

  it("renders approvals page with empty queue", async () => {
    const app = createApp({ deployDir: testDir });
    const res = await app.request("/approvals");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Approval Queue");
    expect(html).toContain("No pending approvals");
  });

  it("renders skills page with empty manifest", async () => {
    const app = createApp({ deployDir: testDir });
    const res = await app.request("/skills");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Installed Skills");
    expect(html).toContain("0 skill(s) installed");
  });

  it("renders init wizard page", async () => {
    const app = createApp({ deployDir: testDir });
    const res = await app.request("/init");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Init Wizard");
    expect(html).toContain("Forge Agent");
  });
});

describe("dashboard API endpoints", () => {
  it("GET /api/status returns status card HTML", async () => {
    const app = createApp({ deployDir: testDir });
    const res = await app.request("/api/status");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Agent Health");
  });

  it("POST /api/doctor returns check results", async () => {
    const app = createApp({ deployDir: testDir });
    const res = await app.request("/api/doctor", { method: "POST" });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("config-exists");
  });

  it("GET /api/logs returns log output", async () => {
    const app = createApp({ deployDir: testDir });
    const res = await app.request("/api/logs?lines=10");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<pre");
  });

  it("GET /api/approvals returns approval list", async () => {
    const app = createApp({ deployDir: testDir });
    const res = await app.request("/api/approvals");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No pending items");
  });

  it("GET /api/skills returns skill list", async () => {
    const app = createApp({ deployDir: testDir });
    const res = await app.request("/api/skills");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No skills installed");
  });

  it("POST /api/skills/install rejects empty source", async () => {
    const app = createApp({ deployDir: testDir });
    const formData = new FormData();
    formData.append("source", "");
    const res = await app.request("/api/skills/install", {
      method: "POST",
      body: formData,
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Skill source is required");
  });

  it("POST /api/init rejects empty blueprint", async () => {
    const app = createApp({ deployDir: testDir });
    const formData = new FormData();
    formData.append("blueprint", "");
    const res = await app.request("/api/init", {
      method: "POST",
      body: formData,
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Blueprint selection is required");
  });
});

describe("approvals with items", () => {
  it("shows pending items with approve/reject buttons", async () => {
    await writeFile(
      join(testDir, "workspace", "memory", "approval-queue.json"),
      JSON.stringify({
        version: 1,
        items: [{
          id: "test-item-001",
          category: "send_email",
          summary: "Send weekly report",
          detail: "Email to team@example.com",
          source: "email-digest",
          status: "pending",
          createdAt: "2026-03-19T10:00:00Z",
        }],
      }) + "\n",
    );

    const app = createApp({ deployDir: testDir });
    const res = await app.request("/approvals");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("1 pending");
    expect(html).toContain("Send weekly report");
    expect(html).toContain("send_email");
    expect(html).toContain("Approve");
    expect(html).toContain("Reject");
  });
});

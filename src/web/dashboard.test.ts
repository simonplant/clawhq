/**
 * Tests for the web dashboard — route rendering and API endpoints.
 *
 * Uses Hono's built-in test client (app.request) rather than starting
 * a real HTTP server. Verifies all 7 pages render and key API endpoints
 * return valid HTML fragments.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GATEWAY_DEFAULT_PORT } from "../config/defaults.js";

// Stub streamLogs so /api/logs tests don't fork a real `docker compose logs`
// subprocess. Under CI — especially Node 24 — 30 sequential invocations blew
// past the 5s test timeout. The dashboard tests are about routing, rate
// limiting, and rendering — not docker.
vi.mock("../operate/logs/index.js", () => ({
  streamLogs: vi.fn(async () => ({ success: true, output: "", lineCount: 0 })),
}));

import { createApp } from "./server.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Extract CSRF token from rendered HTML (from hx-headers on body). */
function extractCsrfToken(html: string): string {
  const match = html.match(/X-CSRF-Token&quot;:&quot;([^&]+)&quot;/);
  if (match) return match[1] ?? "";
  // Try unescaped variant (raw JSON in attribute)
  const rawMatch = html.match(/X-CSRF-Token":"([^"]+)"/);
  return rawMatch?.[1] ?? "";
}

/** Get CSRF token from the app by fetching the home page. */
async function getCsrfToken(app: ReturnType<typeof createApp>): Promise<string> {
  const res = await app.request("/");
  const html = await res.text();
  return extractCsrfToken(html);
}

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

  it("embeds CSRF token in page HTML via hx-headers", async () => {
    const app = createApp({ deployDir: testDir });
    const res = await app.request("/");
    const html = await res.text();
    const token = extractCsrfToken(html);
    expect(token).toBeTruthy();
    expect(token.length).toBe(64); // 32 bytes hex
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

  it("POST /api/doctor returns check results with CSRF token", async () => {
    const app = createApp({ deployDir: testDir });
    const token = await getCsrfToken(app);
    const res = await app.request("/api/doctor", {
      method: "POST",
      headers: { "X-CSRF-Token": token },
    });
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

  it("POST /api/skills/install rejects empty source with 400", async () => {
    const app = createApp({ deployDir: testDir });
    const token = await getCsrfToken(app);
    const formData = new FormData();
    formData.append("source", "");
    const res = await app.request("/api/skills/install", {
      method: "POST",
      headers: { "X-CSRF-Token": token },
      body: formData,
    });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("Skill source is required");
  });

  it("POST /api/init rejects empty blueprint with 400", async () => {
    const app = createApp({ deployDir: testDir });
    const token = await getCsrfToken(app);
    const formData = new FormData();
    formData.append("blueprint", "");
    const res = await app.request("/api/init", {
      method: "POST",
      headers: { "X-CSRF-Token": token },
      body: formData,
    });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("Blueprint selection is required");
  });

  it("POST /api/init rejects invalid gateway port", async () => {
    const app = createApp({ deployDir: testDir });
    const token = await getCsrfToken(app);
    for (const bad of ["abc", "0", "65536", "-1"]) {
      const formData = new FormData();
      formData.append("blueprint", "email-manager");
      formData.append("gatewayPort", bad);
      const res = await app.request("/api/init", {
        method: "POST",
        headers: { "X-CSRF-Token": token },
        body: formData,
      });
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain("Invalid gateway port: must be 1-65535");
    }
  });

  it("POST /api/init rejects path traversal in deployDir", async () => {
    const app = createApp({ deployDir: testDir });
    const token = await getCsrfToken(app);
    const formData = new FormData();
    formData.append("blueprint", "email-manager");
    formData.append("deployDir", "/tmp/evil-traversal");
    const res = await app.request("/api/init", {
      method: "POST",
      headers: { "X-CSRF-Token": token },
      body: formData,
    });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("Deploy directory must be within your home directory");
  });
});

describe("CSRF protection", () => {
  it("POST without CSRF token returns 403", async () => {
    const app = createApp({ deployDir: testDir });
    const res = await app.request("/api/doctor", { method: "POST" });
    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).toContain("CSRF token validation failed");
  });

  it("POST with wrong CSRF token returns 403", async () => {
    const app = createApp({ deployDir: testDir });
    const res = await app.request("/api/doctor", {
      method: "POST",
      headers: { "X-CSRF-Token": "wrong-token" },
    });
    expect(res.status).toBe(403);
  });

  it("POST with valid CSRF token succeeds", async () => {
    const app = createApp({ deployDir: testDir });
    const token = await getCsrfToken(app);
    const res = await app.request("/api/doctor", {
      method: "POST",
      headers: { "X-CSRF-Token": token },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("config-exists");
  });

  it("GET requests do not require CSRF token", async () => {
    const app = createApp({ deployDir: testDir });
    const res = await app.request("/api/status");
    expect(res.status).toBe(200);
  });

  it("different app instances have different CSRF tokens", async () => {
    const app1 = createApp({ deployDir: testDir });
    const app2 = createApp({ deployDir: testDir });
    const token1 = await getCsrfToken(app1);
    const token2 = await getCsrfToken(app2);
    expect(token1).not.toBe(token2);
  });
});

describe("path traversal protection", () => {
  it("rejects sibling directory with similar prefix (user-evil for user)", async () => {
    const app = createApp({ deployDir: testDir });
    const token = await getCsrfToken(app);
    const home = homedir();
    const formData = new FormData();
    formData.append("blueprint", "email-manager");
    formData.append("deployDir", home + "-evil");
    const res = await app.request("/api/init", {
      method: "POST",
      headers: { "X-CSRF-Token": token },
      body: formData,
    });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("Deploy directory must be within your home directory");
  });

  it("rejects parent directory traversal via ..", async () => {
    const app = createApp({ deployDir: testDir });
    const token = await getCsrfToken(app);
    const home = homedir();
    const formData = new FormData();
    formData.append("blueprint", "email-manager");
    formData.append("deployDir", home + "/../etc");
    const res = await app.request("/api/init", {
      method: "POST",
      headers: { "X-CSRF-Token": token },
      body: formData,
    });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("Deploy directory must be within your home directory");
  });

  it("accepts subdirectory of home", async () => {
    const app = createApp({ deployDir: testDir });
    const token = await getCsrfToken(app);
    const home = homedir();
    const formData = new FormData();
    formData.append("blueprint", "email-manager");
    formData.append("deployDir", home + "/.clawhq");
    const res = await app.request("/api/init", {
      method: "POST",
      headers: { "X-CSRF-Token": token },
      body: formData,
    });
    // Should not be 400 for the path check — may fail for other reasons (blueprint loading)
    // but should not be a path traversal rejection
    const html = await res.text();
    expect(html).not.toContain("Deploy directory must be within your home directory");
  });
});

describe("/api/logs rate limiting and line cap", () => {
  it("caps line count at 10000", async () => {
    const app = createApp({ deployDir: testDir });
    // Request 99999 lines — should not error, just cap
    const res = await app.request("/api/logs?lines=99999");
    expect(res.status).toBe(200);
  });

  it("returns 429 when rate limit exceeded", async () => {
    const app = createApp({ deployDir: testDir });
    // Fire 30 requests to fill the rate window
    for (let i = 0; i < 30; i++) {
      const res = await app.request("/api/logs?lines=10");
      expect(res.status).toBe(200);
    }
    // 31st should be rate limited
    const res = await app.request("/api/logs?lines=10");
    expect(res.status).toBe(429);
    const html = await res.text();
    expect(html).toContain("Rate limit exceeded");
  });

  it("handles non-numeric lines gracefully", async () => {
    const app = createApp({ deployDir: testDir });
    const res = await app.request("/api/logs?lines=abc");
    expect(res.status).toBe(200);
  });
});

describe("HTTP status codes", () => {
  it("returns 400 for validation errors", async () => {
    const app = createApp({ deployDir: testDir });
    const token = await getCsrfToken(app);

    // Empty blueprint
    const formData = new FormData();
    formData.append("blueprint", "");
    const res = await app.request("/api/init", {
      method: "POST",
      headers: { "X-CSRF-Token": token },
      body: formData,
    });
    expect(res.status).toBe(400);

    // Empty skill source
    const formData2 = new FormData();
    formData2.append("source", "");
    const res2 = await app.request("/api/skills/install", {
      method: "POST",
      headers: { "X-CSRF-Token": token },
      body: formData2,
    });
    expect(res2.status).toBe(400);
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

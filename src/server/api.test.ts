import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";
import type { ServerConfig } from "./context.js";

function makeConfig(): ServerConfig {
  return {
    port: 18790,
    host: "127.0.0.1",
    openclawHome: "/tmp/oc-test",
  };
}

// Mock all business logic modules with dynamic imports
vi.mock("../operate/status/index.js", () => ({
  collectStatus: vi.fn().mockResolvedValue({
    timestamp: "2026-03-16T00:00:00Z",
    agent: { state: "running", containerId: "abc123" },
    integrations: { entries: [], counts: { healthy: 0, degraded: 0, failed: 0 } },
    workspace: { totalMemoryBytes: 1024, totalIdentityTokens: 500 },
    egress: { today: { bytes: 0, calls: 0 }, zeroEgress: true },
  }),
}));

vi.mock("../operate/doctor/index.js", () => {
  const check = {
    name: "test-check",
    run: vi.fn().mockResolvedValue({ name: "test-check", status: "pass", message: "OK", fix: "" }),
    fix: vi.fn().mockResolvedValue({ name: "test-check", fixed: true, message: "Fixed" }),
  };
  return {
    DEFAULT_CHECKS: [check],
    runChecks: vi.fn().mockResolvedValue({
      checks: [{ name: "test-check", status: "pass", message: "OK", fix: "" }],
      passed: true,
      counts: { pass: 1, warn: 0, fail: 0 },
    }),
    runFixes: vi.fn().mockResolvedValue([
      { name: "test-check", fixed: true, message: "Fixed" },
    ]),
    isFixable: vi.fn().mockReturnValue(true),
  };
});

vi.mock("../operate/approval/index.js", () => ({
  getPending: vi.fn().mockResolvedValue([]),
  approve: vi.fn().mockResolvedValue({ id: "a1", status: "approved" }),
  reject: vi.fn().mockResolvedValue({ id: "a1", status: "rejected" }),
}));

vi.mock("../operate/alerts/index.js", () => ({
  loadHistory: vi.fn().mockResolvedValue([]),
  generateAlerts: vi.fn().mockReturnValue({
    timestamp: "2026-03-16T00:00:00Z",
    alerts: [],
    counts: { info: 0, warning: 0, critical: 0 },
    metricSummary: { tracked: 0, trending: 0, stable: 0 },
  }),
}));

vi.mock("../operate/backup/index.js", () => ({
  listBackups: vi.fn().mockResolvedValue([]),
  createBackup: vi.fn().mockResolvedValue({
    backupId: "bk-001",
    archivePath: "/tmp/backup.tar.gz.gpg",
    manifest: { backupId: "bk-001", files: [] },
  }),
  restoreBackup: vi.fn().mockResolvedValue({
    backupId: "bk-001",
    filesRestored: 5,
    integrityPassed: true,
    doctorPassed: true,
  }),
}));

vi.mock("../evolve/skills/index.js", () => ({
  loadRegistry: vi.fn().mockResolvedValue({ skills: [] }),
  stageSkillInstall: vi.fn().mockResolvedValue({
    manifest: { name: "test-skill", version: "1.0.0" },
    vetResult: { passed: true, warnings: [] },
    stagingDir: "/tmp/staging",
  }),
  activateSkill: vi.fn().mockResolvedValue(undefined),
  removeSkillOp: vi.fn().mockResolvedValue({
    skill: { name: "test-skill" },
    snapshotId: "snap-001",
  }),
}));

vi.mock("../cloud/fleet/index.js", () => ({
  discoverAgents: vi.fn().mockResolvedValue([]),
  collectFleetStatus: vi.fn().mockResolvedValue({
    agents: [],
    healthSummary: { total: 0, healthy: 0, degraded: 0, down: 0 },
  }),
}));

vi.mock("../design/blueprints/index.js", () => ({
  loadBuiltInTemplateChoices: vi.fn().mockResolvedValue([
    { name: "personal-assistant", title: "Replace my PA" },
  ]),
}));

describe("API v1 endpoints", () => {
  // --- JSON endpoints ---

  it("GET /api/v1/status returns ok shape", async () => {
    const app = createApp(makeConfig());
    const res = await app.request("/api/v1/status");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data).toBeDefined();
    expect(json.data.timestamp).toBeDefined();
  });

  it("GET /api/v1/doctor returns report", async () => {
    const app = createApp(makeConfig());
    const res = await app.request("/api/v1/doctor");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.passed).toBe(true);
    expect(json.data.counts.pass).toBe(1);
  });

  it("POST /api/v1/doctor/fix returns fix results", async () => {
    const app = createApp(makeConfig());
    const res = await app.request("/api/v1/doctor/fix", { method: "POST" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].fixed).toBe(true);
  });

  it("GET /api/v1/approvals returns pending list", async () => {
    const app = createApp(makeConfig());
    const res = await app.request("/api/v1/approvals");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
  });

  it("POST /api/v1/approvals/:id/approve returns result", async () => {
    const app = createApp(makeConfig());
    const res = await app.request("/api/v1/approvals/a1/approve", { method: "POST" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.status).toBe("approved");
  });

  it("POST /api/v1/approvals/:id/reject returns result", async () => {
    const app = createApp(makeConfig());
    const res = await app.request("/api/v1/approvals/a1/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Not needed" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.status).toBe("rejected");
  });

  it("GET /api/v1/alerts returns alert report", async () => {
    const app = createApp(makeConfig());
    const res = await app.request("/api/v1/alerts");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.alerts).toEqual([]);
  });

  it("GET /api/v1/backups returns list", async () => {
    const app = createApp(makeConfig());
    const res = await app.request("/api/v1/backups");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
  });

  it("POST /api/v1/backups creates backup", async () => {
    const app = createApp(makeConfig());
    const res = await app.request("/api/v1/backups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gpgRecipient: "test@example.com" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.backupId).toBe("bk-001");
  });

  it("POST /api/v1/backups/:id/restore returns result", async () => {
    const app = createApp(makeConfig());
    const res = await app.request("/api/v1/backups/bk-001/restore", { method: "POST" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.filesRestored).toBe(5);
  });

  it("GET /api/v1/skills returns registry", async () => {
    const app = createApp(makeConfig());
    const res = await app.request("/api/v1/skills");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.skills).toEqual([]);
  });

  it("POST /api/v1/skills installs a skill", async () => {
    const app = createApp(makeConfig());
    const res = await app.request("/api/v1/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "test-skill" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.manifest.name).toBe("test-skill");
  });

  it("POST /api/v1/skills returns 400 without source", async () => {
    const app = createApp(makeConfig());
    const res = await app.request("/api/v1/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toContain("source");
  });

  it("DELETE /api/v1/skills/:name removes a skill", async () => {
    const app = createApp(makeConfig());
    const res = await app.request("/api/v1/skills/test-skill", { method: "DELETE" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("GET /api/v1/fleet returns fleet report", async () => {
    const app = createApp(makeConfig());
    const res = await app.request("/api/v1/fleet");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.agents).toEqual([]);
  });

  it("GET /api/v1/templates returns template list", async () => {
    const app = createApp(makeConfig());
    const res = await app.request("/api/v1/templates");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].name).toBe("personal-assistant");
  });

  // --- SSE endpoints (verify they return streaming response) ---

  it("POST /api/v1/deploy/up returns SSE response", async () => {
    // Mock deployUp for SSE test
    vi.doMock("../deploy/deploy.js", () => ({
      deployUp: vi.fn().mockResolvedValue({
        success: true,
        steps: [{ name: "Compose up", status: "done", message: "OK", durationMs: 100 }],
      }),
    }));

    const app = createApp(makeConfig());
    const res = await app.request("/api/v1/deploy/up", { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
  });

  it("POST /api/v1/deploy/down returns SSE response", async () => {
    vi.doMock("../deploy/deploy.js", () => ({
      deployDown: vi.fn().mockResolvedValue({
        success: true,
        steps: [{ name: "Compose down", status: "done", message: "Stopped", durationMs: 50 }],
      }),
    }));

    const app = createApp(makeConfig());
    const res = await app.request("/api/v1/deploy/down", { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
  });

  it("POST /api/v1/deploy/restart returns SSE response", async () => {
    vi.doMock("../deploy/deploy.js", () => ({
      deployRestart: vi.fn().mockResolvedValue({
        success: true,
        steps: [{ name: "Restart", status: "done", message: "OK", durationMs: 200 }],
      }),
    }));

    const app = createApp(makeConfig());
    const res = await app.request("/api/v1/deploy/restart", { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
  });

  it("POST /api/v1/build returns SSE response", async () => {
    vi.doMock("../docker/build.js", () => ({
      twoStageBuild: vi.fn().mockResolvedValue({
        stage1: null,
        stage2: { stage: 2, success: true, imageTag: "clawhq:latest", durationMs: 500 },
        totalDurationMs: 500,
      }),
    }));
    vi.doMock("../docker/client.js", () => ({
      DockerClient: vi.fn().mockImplementation(() => ({})),
    }));

    const app = createApp(makeConfig());
    const res = await app.request("/api/v1/build", { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
  });
});

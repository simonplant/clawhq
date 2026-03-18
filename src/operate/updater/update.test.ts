import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runUpdate } from "./update.js";

// Mock all external dependencies
vi.mock("../../build/docker/client.js", () => {
  class MockDockerClient {
    exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    imageInspect = vi.fn().mockResolvedValue({
      id: "sha256:abc123",
      layers: [],
      size: 100,
      created: "2026-01-01T00:00:00Z",
      config: { Labels: { "org.openclaw.version": "v1.0.0" } },
    });
    imageExists = vi.fn().mockResolvedValue(true);
    up = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    down = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    build = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    composeExec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
  }
  return { DockerClient: MockDockerClient };
});

vi.mock("../../build/docker/build.js", () => ({
  twoStageBuild: vi.fn().mockResolvedValue({
    stage1: null,
    stage2: { stage: 2, success: true, imageTag: "openclaw:custom", durationMs: 100 },
    totalDurationMs: 100,
  }),
}));

vi.mock("../backup/backup.js", () => ({
  createBackup: vi.fn().mockResolvedValue({
    backupId: "backup-test-123",
    archivePath: "/tmp/backup.tar.gpg",
    manifest: { files: [] },
  }),
}));

vi.mock("../doctor/runner.js", () => ({
  runChecks: vi.fn().mockResolvedValue({
    checks: [],
    passed: true,
    counts: { pass: 5, warn: 0, fail: 0 },
  }),
}));

vi.mock("../../gateway/health.js", () => ({
  pollGatewayHealth: vi.fn().mockResolvedValue({
    status: "up",
    latencyMs: 15,
  }),
  HealthPollTimeout: class extends Error {
    timeoutMs: number;
    lastStatus: string;
    constructor(lastStatus: string, timeoutMs: number) {
      super(`Timed out after ${timeoutMs}ms`);
      this.lastStatus = lastStatus;
      this.timeoutMs = timeoutMs;
    }
  },
}));

vi.mock("../../secure/firewall/firewall.js", () => ({
  buildConfig: vi.fn().mockResolvedValue({ rules: [] }),
  apply: vi.fn().mockResolvedValue({ success: true, message: "Firewall applied" }),
}));

vi.mock("./rollback.js", () => ({
  rollback: vi.fn().mockResolvedValue({
    success: true,
    steps: [{ name: "Restore image", status: "done", message: "OK", durationMs: 10 }],
  }),
}));

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runUpdate", () => {
  it("reports no update available when already on latest", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: "v1.0.0",
        published_at: "2026-01-01T00:00:00Z",
        html_url: "",
      }),
    });

    const result = await runUpdate({ repo: "test/repo" });

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].name).toBe("Version check");
    expect(result.steps[0].message).toContain("up to date");
  });

  it("in check-only mode, stops after changelog", async () => {
    // Version check fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: "v2.0.0",
        published_at: "2026-03-10T00:00:00Z",
        html_url: "",
      }),
    });

    // Changelog fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [
        { tag_name: "v2.0.0", published_at: "2026-03-10", body: "New stuff" },
        { tag_name: "v1.0.0", published_at: "2026-01-01", body: "Old" },
      ],
    });

    const result = await runUpdate({ repo: "test/repo", checkOnly: true });

    expect(result.success).toBe(true);
    expect(result.previousVersion).toBe("v1.0.0");
    expect(result.newVersion).toBe("v2.0.0");
    expect(result.rolledBack).toBe(false);
    // Should have version check + changelog steps only
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].name).toBe("Version check");
    expect(result.steps[1].name).toBe("Changelog");
  });

  it("handles version check failure gracefully", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const result = await runUpdate({ repo: "test/repo" });

    expect(result.success).toBe(false);
    expect(result.steps[0].status).toBe("failed");
    expect(result.steps[0].message).toContain("Cannot reach GitHub API");
  });
});

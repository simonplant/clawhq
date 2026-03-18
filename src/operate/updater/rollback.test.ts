import { afterEach, describe, expect, it, vi } from "vitest";

import { rollback } from "./rollback.js";

// Mock external dependencies
vi.mock("../../build/docker/client.js", () => {
  class MockDockerClient {
    exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    up = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    down = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    composeExec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
  }
  return { DockerClient: MockDockerClient };
});

vi.mock("../../gateway/health.js", () => ({
  pollGatewayHealth: vi.fn().mockResolvedValue({
    status: "up",
    latencyMs: 10,
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rollback", () => {
  it("restores previous image and restarts", async () => {
    const result = await rollback({
      previousImageTag: "openclaw:custom-pre-update",
    });

    expect(result.success).toBe(true);
    expect(result.steps.length).toBeGreaterThanOrEqual(4);
    expect(result.steps[0].name).toBe("Restore image");
    expect(result.steps[0].status).toBe("done");
  });

  it("includes firewall reapply step", async () => {
    const result = await rollback({
      previousImageTag: "openclaw:custom-pre-update",
    });

    const firewallStep = result.steps.find((s) => s.name === "Firewall reapply");
    expect(firewallStep).toBeDefined();
  });

  it("includes health verification step", async () => {
    const result = await rollback({
      previousImageTag: "openclaw:custom-pre-update",
    });

    const healthStep = result.steps.find((s) => s.name === "Health verify");
    expect(healthStep).toBeDefined();
    expect(healthStep?.status).toBe("done");
  });

  it("succeeds even if firewall fails (non-fatal)", async () => {
    const { apply } = await import("../../secure/firewall/firewall.js");
    vi.mocked(apply).mockResolvedValueOnce({ success: false, message: "iptables not available" });

    const result = await rollback({
      previousImageTag: "openclaw:custom-pre-update",
    });

    // Firewall failure is non-fatal
    expect(result.success).toBe(true);
  });
});

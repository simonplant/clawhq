import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock DockerClient
vi.mock("../docker/client.js", () => {
  class MockDockerClient {
    static composeExecImpl: ((args: string[]) => Promise<{ stdout: string; stderr: string }>) | undefined;
    async composeExec(args: string[]) {
      if (MockDockerClient.composeExecImpl) return MockDockerClient.composeExecImpl(args);
      return { stdout: "", stderr: "" };
    }
  }
  return { DockerClient: MockDockerClient };
});

// Mock gateway health
vi.mock("../gateway/health.js", () => ({
  pollGatewayHealth: vi.fn(),
}));

// Mock firewall
vi.mock("../security/firewall/firewall.js", () => ({
  buildConfig: vi.fn(),
  apply: vi.fn(),
}));

import { DockerClient } from "../docker/client.js";
import { pollGatewayHealth } from "../gateway/health.js";
import {
  apply as applyFirewall,
  buildConfig as buildFirewallConfig,
} from "../security/firewall/firewall.js";

import { reapplyFirewall, reconnectNetwork, repairIssue, restartGateway } from "./actions.js";
import type { DetectedIssue, RepairContext } from "./types.js";

const MockDockerClient = DockerClient as unknown as {
  composeExecImpl: ((args: string[]) => Promise<{ stdout: string; stderr: string }>) | undefined;
};

function makeCtx(overrides: Partial<RepairContext> = {}): RepairContext {
  return {
    openclawHome: "/tmp/openclaw",
    configPath: "/tmp/openclaw/openclaw.json",
    ...overrides,
  };
}

describe("restartGateway", () => {
  beforeEach(() => {
    MockDockerClient.composeExecImpl = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("restarts container and reports repaired on success", async () => {
    vi.mocked(pollGatewayHealth).mockResolvedValue({ status: "up", latencyMs: 10 });

    const result = await restartGateway(makeCtx());

    expect(result.issue).toBe("gateway_down");
    expect(result.status).toBe("repaired");
    expect(result.action).toBe("Container restart");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("reports failed when health poll times out", async () => {
    vi.mocked(pollGatewayHealth).mockRejectedValue(new Error("Health poll timeout"));

    const result = await restartGateway(makeCtx());

    expect(result.status).toBe("failed");
    expect(result.message).toContain("Health poll timeout");
  });

  it("reports failed when compose restart throws", async () => {
    MockDockerClient.composeExecImpl = async () => {
      throw new Error("Docker daemon not running");
    };

    const result = await restartGateway(makeCtx());

    expect(result.status).toBe("failed");
    expect(result.message).toContain("Docker daemon not running");
  });
});

describe("reconnectNetwork", () => {
  beforeEach(() => {
    MockDockerClient.composeExecImpl = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reconnects and reports repaired on success", async () => {
    vi.mocked(pollGatewayHealth).mockResolvedValue({ status: "up", latencyMs: 5 });

    const result = await reconnectNetwork(makeCtx());

    expect(result.issue).toBe("network_drop");
    expect(result.status).toBe("repaired");
    expect(result.action).toBe("Network reconnect");
  });

  it("reports failed when reconnect fails", async () => {
    vi.mocked(pollGatewayHealth).mockRejectedValue(new Error("ETIMEDOUT"));

    const result = await reconnectNetwork(makeCtx());

    expect(result.status).toBe("failed");
    expect(result.message).toContain("ETIMEDOUT");
  });
});

describe("reapplyFirewall", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reapplies firewall and reports repaired", async () => {
    vi.mocked(buildFirewallConfig).mockResolvedValue({
      chainName: "CLAWHQ_FWD",
      bridgeInterface: "docker0",
      allowlist: [],
    });
    vi.mocked(applyFirewall).mockResolvedValue({
      success: true,
      message: "Firewall applied",
    });

    const result = await reapplyFirewall(makeCtx());

    expect(result.issue).toBe("firewall_missing");
    expect(result.status).toBe("repaired");
  });

  it("reports failed when apply returns failure", async () => {
    vi.mocked(buildFirewallConfig).mockResolvedValue({
      chainName: "CLAWHQ_FWD",
      bridgeInterface: "docker0",
      allowlist: [],
    });
    vi.mocked(applyFirewall).mockResolvedValue({
      success: false,
      message: "iptables not available",
    });

    const result = await reapplyFirewall(makeCtx());

    expect(result.status).toBe("failed");
    expect(result.message).toContain("iptables not available");
  });

  it("reports failed when buildConfig throws", async () => {
    vi.mocked(buildFirewallConfig).mockRejectedValue(new Error("Permission denied"));

    const result = await reapplyFirewall(makeCtx());

    expect(result.status).toBe("failed");
    expect(result.message).toContain("Permission denied");
  });
});

describe("repairIssue", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dispatches gateway_down to restartGateway", async () => {
    vi.mocked(pollGatewayHealth).mockResolvedValue({ status: "up", latencyMs: 10 });

    const issue: DetectedIssue = {
      type: "gateway_down",
      message: "Container not running",
      detectedAt: "2026-03-17T00:00:00Z",
    };

    const result = await repairIssue(issue, makeCtx());
    expect(result.issue).toBe("gateway_down");
    expect(result.action).toBe("Container restart");
  });

  it("dispatches network_drop to reconnectNetwork", async () => {
    vi.mocked(pollGatewayHealth).mockResolvedValue({ status: "up", latencyMs: 5 });

    const issue: DetectedIssue = {
      type: "network_drop",
      message: "ECONNREFUSED",
      detectedAt: "2026-03-17T00:00:00Z",
    };

    const result = await repairIssue(issue, makeCtx());
    expect(result.issue).toBe("network_drop");
    expect(result.action).toBe("Network reconnect");
  });

  it("dispatches firewall_missing to reapplyFirewall", async () => {
    vi.mocked(buildFirewallConfig).mockResolvedValue({
      chainName: "CLAWHQ_FWD",
      bridgeInterface: "docker0",
      allowlist: [],
    });
    vi.mocked(applyFirewall).mockResolvedValue({
      success: true,
      message: "Applied",
    });

    const issue: DetectedIssue = {
      type: "firewall_missing",
      message: "Chain missing",
      detectedAt: "2026-03-17T00:00:00Z",
    };

    const result = await repairIssue(issue, makeCtx());
    expect(result.issue).toBe("firewall_missing");
    expect(result.action).toBe("Firewall reapply");
  });
});

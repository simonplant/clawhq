import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RepairContext } from "./types.js";

// Mock DockerClient
vi.mock("../docker/client.js", () => {
  class MockDockerClient {
    static psImpl: (() => Promise<Array<{ id: string; name: string; state: string; status: string; image: string; ports: string }>>) | undefined;
    async ps() {
      if (MockDockerClient.psImpl) return MockDockerClient.psImpl();
      return [];
    }
    async composeExec() {
      return { stdout: "", stderr: "" };
    }
  }
  return { DockerClient: MockDockerClient };
});

// Mock gateway health
vi.mock("../gateway/health.js", () => ({
  checkHealth: vi.fn(),
}));

// Mock iptables
vi.mock("../security/firewall/iptables.js", () => ({
  chainExists: vi.fn(),
}));

vi.mock("../security/firewall/types.js", () => ({
  CHAIN_NAME: "CLAWHQ_FWD",
}));

import { DockerClient } from "../docker/client.js";
import { checkHealth } from "../gateway/health.js";
import { chainExists } from "../security/firewall/iptables.js";

import { checkFirewall, checkGateway, checkNetwork, detectIssues } from "./monitor.js";

const MockDockerClient = DockerClient as unknown as {
  psImpl: (() => Promise<Array<{ id: string; name: string; state: string; status: string; image: string; ports: string }>>) | undefined;
};

function makeCtx(overrides: Partial<RepairContext> = {}): RepairContext {
  return {
    openclawHome: "/tmp/openclaw",
    configPath: "/tmp/openclaw/openclaw.json",
    ...overrides,
  };
}

describe("checkGateway", () => {
  beforeEach(() => {
    MockDockerClient.psImpl = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when container is running and gateway is up", async () => {
    MockDockerClient.psImpl = async () => [
      { id: "abc", name: "openclaw", state: "running", status: "Up", image: "openclaw:custom", ports: "" },
    ];
    vi.mocked(checkHealth).mockResolvedValue({ status: "up", latencyMs: 10 });

    const issue = await checkGateway(makeCtx());
    expect(issue).toBeNull();
  });

  it("detects no running container", async () => {
    MockDockerClient.psImpl = async () => [];

    const issue = await checkGateway(makeCtx());
    expect(issue).not.toBeNull();
    expect(issue!.type).toBe("gateway_down");
    expect(issue!.message).toContain("No agent container");
  });

  it("detects container not running", async () => {
    MockDockerClient.psImpl = async () => [
      { id: "abc", name: "openclaw", state: "exited", status: "Exited (1)", image: "openclaw:custom", ports: "" },
    ];

    const issue = await checkGateway(makeCtx());
    expect(issue).not.toBeNull();
    expect(issue!.type).toBe("gateway_down");
    expect(issue!.message).toContain("exited");
  });

  it("detects gateway down even when container is running", async () => {
    MockDockerClient.psImpl = async () => [
      { id: "abc", name: "openclaw", state: "running", status: "Up", image: "openclaw:custom", ports: "" },
    ];
    vi.mocked(checkHealth).mockResolvedValue({
      status: "down",
      latencyMs: 100,
      error: "Gateway not responding",
    });

    const issue = await checkGateway(makeCtx());
    expect(issue).not.toBeNull();
    expect(issue!.type).toBe("gateway_down");
    expect(issue!.message).toContain("down");
  });
});

describe("checkNetwork", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when network is healthy", async () => {
    vi.mocked(checkHealth).mockResolvedValue({ status: "up", latencyMs: 5 });

    const issue = await checkNetwork(makeCtx());
    expect(issue).toBeNull();
  });

  it("detects network drop", async () => {
    vi.mocked(checkHealth).mockResolvedValue({
      status: "down",
      latencyMs: 100,
      error: "ECONNREFUSED",
    });

    const issue = await checkNetwork(makeCtx());
    expect(issue).not.toBeNull();
    expect(issue!.type).toBe("network_drop");
    expect(issue!.message).toContain("ECONNREFUSED");
  });

  it("returns null for non-network errors", async () => {
    vi.mocked(checkHealth).mockResolvedValue({
      status: "down",
      latencyMs: 100,
      error: "something else",
    });

    const issue = await checkNetwork(makeCtx());
    expect(issue).toBeNull();
  });
});

describe("checkFirewall", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when firewall chain exists", async () => {
    vi.mocked(chainExists).mockResolvedValue(true);

    const issue = await checkFirewall(makeCtx());
    expect(issue).toBeNull();
  });

  it("detects missing firewall chain", async () => {
    vi.mocked(chainExists).mockResolvedValue(false);

    const issue = await checkFirewall(makeCtx());
    expect(issue).not.toBeNull();
    expect(issue!.type).toBe("firewall_missing");
    expect(issue!.message).toContain("CLAWHQ_FWD");
  });

  it("returns null when iptables is unsupported", async () => {
    vi.mocked(chainExists).mockRejectedValue(new Error("not supported"));

    const issue = await checkFirewall(makeCtx());
    expect(issue).toBeNull();
  });
});

describe("detectIssues", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty array when all healthy", async () => {
    MockDockerClient.psImpl = async () => [
      { id: "abc", name: "openclaw", state: "running", status: "Up", image: "openclaw:custom", ports: "" },
    ];
    vi.mocked(checkHealth).mockResolvedValue({ status: "up", latencyMs: 5 });
    vi.mocked(chainExists).mockResolvedValue(true);

    const issues = await detectIssues(makeCtx());
    expect(issues).toHaveLength(0);
  });

  it("returns multiple issues when multiple problems detected", async () => {
    MockDockerClient.psImpl = async () => [];
    vi.mocked(checkHealth).mockResolvedValue({
      status: "down",
      latencyMs: 100,
      error: "ECONNREFUSED",
    });
    vi.mocked(chainExists).mockResolvedValue(false);

    const issues = await detectIssues(makeCtx());
    expect(issues.length).toBeGreaterThanOrEqual(2);
  });
});

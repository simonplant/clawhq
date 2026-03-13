import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks ---

let composeUpImpl: (() => Promise<{ stdout: string; stderr: string }>) | undefined;
let composeDownImpl: (() => Promise<{ stdout: string; stderr: string }>) | undefined;
let composePsImpl: (() => Promise<Array<{ id: string; name: string; state: string; status: string; image: string; ports: string }>>) | undefined;
let composeLogsImpl: (() => Promise<{ stdout: string; stderr: string }>) | undefined;

vi.mock("../docker/client.js", () => {
  class MockDockerClient {
    async up() {
      if (composeUpImpl) return composeUpImpl();
      return { stdout: "", stderr: "" };
    }
    async down() {
      if (composeDownImpl) return composeDownImpl();
      return { stdout: "", stderr: "" };
    }
    async ps() {
      if (composePsImpl) return composePsImpl();
      return [{ id: "abc123", name: "openclaw", state: "running", status: "Up", image: "openclaw:custom", ports: "18789" }];
    }
    async logs() {
      if (composeLogsImpl) return composeLogsImpl();
      return { stdout: "container logs here", stderr: "" };
    }
  }

  class MockHealthPollTimeout extends Error {
    name = "HealthPollTimeout";
    containerId: string;
    lastStatus: string;
    timeoutMs: number;
    constructor(containerId: string, lastStatus: string, timeoutMs: number) {
      super(`timed out after ${timeoutMs}ms`);
      this.containerId = containerId;
      this.lastStatus = lastStatus;
      this.timeoutMs = timeoutMs;
    }
  }

  return {
    DockerClient: MockDockerClient,
    HealthPollTimeout: MockHealthPollTimeout,
  };
});

// Mock preflight — always passes by default
vi.mock("./preflight.js", () => ({
  runPreflight: vi.fn().mockResolvedValue({
    passed: true,
    steps: [
      { name: "Docker daemon", status: "done", message: "Running", durationMs: 10 },
      { name: "Container images", status: "done", message: "Found", durationMs: 10 },
      { name: "Config validation", status: "done", message: "Valid", durationMs: 10 },
      { name: "Secrets file", status: "done", message: "Found", durationMs: 10 },
      { name: "Port availability", status: "done", message: "Available", durationMs: 10 },
      { name: "Ollama reachable", status: "done", message: "Reachable", durationMs: 10 },
    ],
  }),
}));

// Mock firewall
vi.mock("../security/firewall/firewall.js", () => ({
  buildConfig: vi.fn().mockResolvedValue({
    chainName: "CLAWHQ_FWD",
    bridgeInterface: "docker0",
    allowlist: [],
  }),
  apply: vi.fn().mockResolvedValue({ success: true, message: "Firewall applied: 3 domains" }),
}));

// Mock gateway health
let gatewayHealthImpl: (() => Promise<{ status: string; latencyMs: number }>) | undefined;

vi.mock("../gateway/health.js", () => {
  class MockHealthPollTimeout extends Error {
    name = "HealthPollTimeout";
    lastStatus: string;
    timeoutMs: number;
    constructor(lastStatus: string, timeoutMs: number) {
      super(`Gateway health poll timed out after ${timeoutMs}ms`);
      this.lastStatus = lastStatus;
      this.timeoutMs = timeoutMs;
    }
  }

  return {
    pollGatewayHealth: vi.fn(async () => {
      if (gatewayHealthImpl) return gatewayHealthImpl();
      return { status: "up", latencyMs: 42 };
    }),
    HealthPollTimeout: MockHealthPollTimeout,
  };
});

import { pollGatewayHealth, HealthPollTimeout } from "../gateway/health.js";
import { apply as applyFirewall } from "../security/firewall/firewall.js";

import { deployDown, deployRestart, deployUp } from "./deploy.js";
import { runPreflight } from "./preflight.js";
import type { DeployOptions } from "./types.js";

function defaultOpts(): DeployOptions {
  return {
    openclawHome: "/tmp/openclaw",
    configPath: "/tmp/openclaw/openclaw.json",
    healthTimeoutMs: 5000,
  };
}

describe("deployUp", () => {
  beforeEach(() => {
    composeUpImpl = undefined;
    composeDownImpl = undefined;
    composePsImpl = undefined;
    composeLogsImpl = undefined;
    gatewayHealthImpl = undefined;
    vi.mocked(runPreflight).mockResolvedValue({
      passed: true,
      steps: [
        { name: "Docker daemon", status: "done", message: "Running", durationMs: 10 },
      ],
    });
    vi.mocked(applyFirewall).mockResolvedValue({ success: true, message: "Firewall applied" });
    vi.mocked(pollGatewayHealth).mockResolvedValue({ status: "up", latencyMs: 42 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("succeeds with full deploy sequence", async () => {
    const result = await deployUp(defaultOpts());

    expect(result.success).toBe(true);
    expect(result.steps.length).toBe(4); // preflight, compose up, firewall, health
    expect(result.steps[0].name).toBe("Pre-flight checks");
    expect(result.steps[1].name).toBe("Compose up");
    expect(result.steps[2].name).toBe("Firewall apply");
    expect(result.steps[3].name).toBe("Health poll");
  });

  it("fails when pre-flight fails", async () => {
    vi.mocked(runPreflight).mockResolvedValue({
      passed: false,
      steps: [
        { name: "Docker daemon", status: "failed", message: "Not running", durationMs: 10 },
      ],
    });

    const result = await deployUp(defaultOpts());

    expect(result.success).toBe(false);
    expect(result.steps.length).toBe(1); // Only pre-flight
    expect(result.steps[0].status).toBe("failed");
  });

  it("fails when compose up fails", async () => {
    composeUpImpl = async () => {
      throw new Error("port already in use");
    };

    const result = await deployUp(defaultOpts());

    expect(result.success).toBe(false);
    const composeStep = result.steps.find((s) => s.name === "Compose up");
    expect(composeStep?.status).toBe("failed");
    // Should not proceed to firewall/health
    expect(result.steps.length).toBe(2);
  });

  it("reports health poll timeout with logs", async () => {
    vi.mocked(pollGatewayHealth).mockRejectedValue(
      new HealthPollTimeout("down", 5000),
    );

    const result = await deployUp(defaultOpts());

    expect(result.success).toBe(false);
    const healthStep = result.steps.find((s) => s.name === "Health poll");
    expect(healthStep?.status).toBe("failed");
    expect(healthStep?.message).toContain("timed out");
  });

  it("returns container ID on success", async () => {
    const result = await deployUp(defaultOpts());

    expect(result.containerId).toBe("abc123");
  });

  it("exit code is non-zero on deployment failure", async () => {
    composeUpImpl = async () => {
      throw new Error("fail");
    };

    const result = await deployUp(defaultOpts());

    expect(result.success).toBe(false);
  });
});

describe("deployDown", () => {
  beforeEach(() => {
    composeDownImpl = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stops containers gracefully", async () => {
    const result = await deployDown(defaultOpts());

    expect(result.success).toBe(true);
    expect(result.steps.length).toBe(1);
    expect(result.steps[0].name).toBe("Compose down");
    expect(result.steps[0].status).toBe("done");
    expect(result.steps[0].message).toContain("gracefully");
  });

  it("reports failure when compose down fails", async () => {
    composeDownImpl = async () => {
      throw new Error("no such container");
    };

    const result = await deployDown(defaultOpts());

    expect(result.success).toBe(false);
    expect(result.steps[0].status).toBe("failed");
  });
});

describe("deployRestart", () => {
  beforeEach(() => {
    composeUpImpl = undefined;
    composeDownImpl = undefined;
    gatewayHealthImpl = undefined;
    vi.mocked(applyFirewall).mockResolvedValue({ success: true, message: "Firewall applied" });
    vi.mocked(pollGatewayHealth).mockResolvedValue({ status: "up", latencyMs: 42 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("succeeds with down -> up -> firewall -> health sequence", async () => {
    const result = await deployRestart(defaultOpts());

    expect(result.success).toBe(true);
    expect(result.steps.length).toBe(4);
    expect(result.steps[0].name).toBe("Compose down");
    expect(result.steps[1].name).toBe("Compose up");
    expect(result.steps[2].name).toBe("Firewall reapply");
    expect(result.steps[3].name).toBe("Health re-verify");
  });

  it("reapplies firewall after restart", async () => {
    await deployRestart(defaultOpts());

    expect(applyFirewall).toHaveBeenCalled();
  });

  it("re-verifies health after restart", async () => {
    await deployRestart(defaultOpts());

    expect(pollGatewayHealth).toHaveBeenCalled();
  });

  it("fails when compose down fails", async () => {
    composeDownImpl = async () => {
      throw new Error("down failed");
    };

    const result = await deployRestart(defaultOpts());

    expect(result.success).toBe(false);
    expect(result.steps.length).toBe(1); // Stops at down
  });

  it("fails when health re-verify times out", async () => {
    vi.mocked(pollGatewayHealth).mockRejectedValue(
      new HealthPollTimeout("down", 5000),
    );

    const result = await deployRestart(defaultOpts());

    expect(result.success).toBe(false);
    const healthStep = result.steps.find((s) => s.name === "Health re-verify");
    expect(healthStep?.status).toBe("failed");
    expect(healthStep?.message).toContain("timed out");
  });
});

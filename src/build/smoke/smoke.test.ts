import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks ---

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:util", () => ({
  promisify: (fn: unknown) => fn,
}));

let gatewayConnectImpl: (() => Promise<void>) | undefined;
let gatewayCallImpl: ((method: string, params?: Record<string, unknown>) => Promise<unknown>) | undefined;
let gatewayDisconnectImpl: (() => void) | undefined;

vi.mock("../../gateway/websocket.js", () => {
  class MockGatewayClient {
    async connect() {
      if (gatewayConnectImpl) return gatewayConnectImpl();
    }
    async call(method: string, params?: Record<string, unknown>) {
      if (gatewayCallImpl) return gatewayCallImpl(method, params);
      return { result: { text: "OK" } };
    }
    disconnect() {
      if (gatewayDisconnectImpl) gatewayDisconnectImpl();
    }
  }
  return { GatewayClient: MockGatewayClient };
});



import { checkContainerRunning, checkIdentityFiles, checkTestMessage, checkIntegrations } from "./checks.js";
import type { SmokeTestOptions } from "./types.js";

import { runSmokeTest } from "./index.js";

function defaultOpts(): SmokeTestOptions {
  return {
    openclawHome: "/tmp/openclaw",
    configPath: "/tmp/openclaw/openclaw.json",
    gatewayHost: "127.0.0.1",
    gatewayPort: 18789,
    responseTimeoutMs: 5000,
  };
}

interface MockDirent {
  name: string;
  isDirectory: () => boolean;
  isFile: () => boolean;
}

function mockDirent(name: string): MockDirent {
  return { name, isDirectory: () => true, isFile: () => false };
}

describe("checkContainerRunning", () => {
  beforeEach(() => {
    vi.mocked(execFile as unknown as (...args: unknown[]) => unknown).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes when container is running", async () => {
    vi.mocked(execFile as unknown as (...args: unknown[]) => unknown).mockResolvedValue({
      stdout: "abc123def\tUp 5 minutes\trunning\n",
    });

    const result = await checkContainerRunning(defaultOpts());

    expect(result.status).toBe("pass");
    expect(result.message).toContain("abc123def");
    expect(result.message).toContain("running");
  });

  it("fails when no container found", async () => {
    vi.mocked(execFile as unknown as (...args: unknown[]) => unknown).mockResolvedValue({
      stdout: "",
    });

    const result = await checkContainerRunning(defaultOpts());

    expect(result.status).toBe("fail");
    expect(result.message).toContain("No OpenClaw container found");
  });

  it("fails when container is not running", async () => {
    vi.mocked(execFile as unknown as (...args: unknown[]) => unknown).mockResolvedValue({
      stdout: "abc123def\tExited (1) 2 minutes ago\texited\n",
    });

    const result = await checkContainerRunning(defaultOpts());

    expect(result.status).toBe("fail");
    expect(result.message).toContain("exited");
  });

  it("fails when docker command errors", async () => {
    vi.mocked(execFile as unknown as (...args: unknown[]) => unknown).mockRejectedValue(
      new Error("Cannot connect to Docker daemon"),
    );

    const result = await checkContainerRunning(defaultOpts());

    expect(result.status).toBe("fail");
    expect(result.message).toContain("Cannot connect to Docker daemon");
  });
});

describe("checkIdentityFiles", () => {
  beforeEach(() => {
    vi.mocked(readdir).mockReset();
    vi.mocked(stat).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes when all identity files exist and are non-empty", async () => {
    vi.mocked(readdir).mockResolvedValue([mockDirent("default")] as never);
    vi.mocked(stat).mockResolvedValue({ size: 100 } as never);

    const result = await checkIdentityFiles(defaultOpts());

    expect(result.status).toBe("pass");
    expect(result.message).toContain("4 identity files");
  });

  it("fails when identity files are missing", async () => {
    vi.mocked(readdir).mockResolvedValue([mockDirent("default")] as never);
    vi.mocked(stat).mockRejectedValue(new Error("ENOENT"));

    const result = await checkIdentityFiles(defaultOpts());

    expect(result.status).toBe("fail");
    expect(result.message).toContain("Missing identity files");
  });

  it("fails when identity files are empty", async () => {
    vi.mocked(readdir).mockResolvedValue([mockDirent("default")] as never);
    vi.mocked(stat).mockResolvedValue({ size: 0 } as never);

    const result = await checkIdentityFiles(defaultOpts());

    expect(result.status).toBe("fail");
    expect(result.message).toContain("Empty identity files");
  });

  it("fails when no agent workspaces found", async () => {
    vi.mocked(readdir).mockResolvedValue([]);
    vi.mocked(stat).mockRejectedValue(new Error("ENOENT"));

    const result = await checkIdentityFiles(defaultOpts());

    expect(result.status).toBe("fail");
    expect(result.message).toContain("No agent workspaces");
  });

  it("checks workspace root if no subdirectories but SOUL.md exists", async () => {
    vi.mocked(readdir).mockResolvedValue([]);
    vi.mocked(stat).mockResolvedValue({ size: 50 } as never);

    const result = await checkIdentityFiles(defaultOpts());

    expect(result.status).toBe("pass");
  });
});

describe("checkTestMessage", () => {
  beforeEach(() => {
    gatewayConnectImpl = undefined;
    gatewayCallImpl = undefined;
    gatewayDisconnectImpl = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes when agent responds with text", async () => {
    gatewayCallImpl = async () => ({ result: { text: "OK, smoke test passed" } });

    const result = await checkTestMessage(defaultOpts());

    expect(result.status).toBe("pass");
    expect(result.message).toContain("Agent responded");
  });

  it("passes when agent responds with content field", async () => {
    gatewayCallImpl = async () => ({ result: { content: "I'm here" } });

    const result = await checkTestMessage(defaultOpts());

    expect(result.status).toBe("pass");
  });

  it("fails when agent returns error", async () => {
    gatewayCallImpl = async () => ({ error: { code: 500, message: "model not loaded" } });

    const result = await checkTestMessage(defaultOpts());

    expect(result.status).toBe("fail");
    expect(result.message).toContain("model not loaded");
  });

  it("fails when agent returns empty response", async () => {
    gatewayCallImpl = async () => ({ result: { text: "" } });

    const result = await checkTestMessage(defaultOpts());

    expect(result.status).toBe("fail");
    expect(result.message).toContain("empty response");
  });

  it("fails when connection fails", async () => {
    gatewayConnectImpl = async () => {
      throw new Error("Connection refused");
    };

    const result = await checkTestMessage(defaultOpts());

    expect(result.status).toBe("fail");
    expect(result.message).toContain("Connection refused");
  });
});

describe("checkIntegrations", () => {
  beforeEach(() => {
    vi.mocked(readFile).mockReset();
    vi.mocked(execFile as unknown as (...args: unknown[]) => unknown).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips when no integrations configured", async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ channels: {} }));

    const result = await checkIntegrations(defaultOpts());

    expect(result.status).toBe("skip");
    expect(result.message).toContain("No integrations");
  });

  it("passes when all channels are healthy", async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ channels: { telegram: { enabled: true } } }),
    );
    vi.mocked(execFile as unknown as (...args: unknown[]) => unknown).mockResolvedValue({
      stdout: JSON.stringify([{ channel: "telegram", status: "connected" }]),
    });

    const result = await checkIntegrations(defaultOpts());

    expect(result.status).toBe("pass");
    expect(result.message).toContain("telegram");
  });

  it("fails when a channel is unhealthy", async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ channels: { telegram: { enabled: true } } }),
    );
    vi.mocked(execFile as unknown as (...args: unknown[]) => unknown).mockResolvedValue({
      stdout: JSON.stringify([{ channel: "telegram", status: "error", message: "token expired" }]),
    });

    const result = await checkIntegrations(defaultOpts());

    expect(result.status).toBe("fail");
    expect(result.message).toContain("token expired");
  });

  it("falls back gracefully when probe command fails", async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ channels: { telegram: { enabled: true } } }),
    );
    vi.mocked(execFile as unknown as (...args: unknown[]) => unknown).mockRejectedValue(
      new Error("command not found"),
    );

    const result = await checkIntegrations(defaultOpts());

    // Graceful fallback: reports configured channels as healthy
    expect(result.status).toBe("pass");
    expect(result.message).toContain("telegram");
  });

  it("ignores disabled channels", async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        channels: {
          telegram: { enabled: true },
          discord: { enabled: false },
        },
      }),
    );
    vi.mocked(execFile as unknown as (...args: unknown[]) => unknown).mockResolvedValue({
      stdout: JSON.stringify([{ channel: "telegram", status: "connected" }]),
    });

    const result = await checkIntegrations(defaultOpts());

    expect(result.status).toBe("pass");
    expect(result.message).not.toContain("discord");
  });
});

describe("runSmokeTest", () => {
  beforeEach(() => {
    gatewayConnectImpl = undefined;
    gatewayCallImpl = async () => ({ result: { text: "OK" } });
    gatewayDisconnectImpl = undefined;
    vi.mocked(execFile as unknown as (...args: unknown[]) => unknown).mockResolvedValue({
      stdout: "abc123def\tUp 5 minutes\trunning\n",
    });
    vi.mocked(readdir).mockResolvedValue([mockDirent("default")] as never);
    vi.mocked(stat).mockResolvedValue({ size: 100 } as never);
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ channels: {} }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs all four checks", async () => {
    const result = await runSmokeTest(defaultOpts());

    expect(result.checks.length).toBe(4);
    expect(result.checks[0].name).toBe("Container running");
    expect(result.checks[1].name).toBe("Identity files");
    expect(result.checks[2].name).toBe("Test message");
    expect(result.checks[3].name).toBe("Integration probe");
  });

  it("passes when all checks pass", async () => {
    const result = await runSmokeTest(defaultOpts());

    expect(result.passed).toBe(true);
  });

  it("fails when any check fails", async () => {
    vi.mocked(stat).mockRejectedValue(new Error("ENOENT"));
    vi.mocked(readdir).mockResolvedValue([]);

    const result = await runSmokeTest(defaultOpts());

    expect(result.passed).toBe(false);
  });

  it("passes when checks pass or skip", async () => {
    // Integrations will skip (no channels), others pass
    const result = await runSmokeTest(defaultOpts());

    expect(result.passed).toBe(true);
    const integrationCheck = result.checks.find((c) => c.name === "Integration probe");
    expect(integrationCheck?.status).toBe("skip");
  });

  it("fails when container is not running", async () => {
    vi.mocked(execFile as unknown as (...args: unknown[]) => unknown).mockResolvedValue({
      stdout: "",
    });

    const result = await runSmokeTest(defaultOpts());

    expect(result.passed).toBe(false);
    expect(result.checks[0].name).toBe("Container running");
    expect(result.checks[0].status).toBe("fail");
  });
});

import { access } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks ---

// Mock DockerClient
let dockerExecImpl: ((args: string[]) => Promise<{ stdout: string; stderr: string }>) | undefined;

vi.mock("../docker/client.js", () => {
  class MockDaemonNotRunning extends Error {
    name = "DaemonNotRunning";
    stderr: string;
    exitCode: number | null;
    constructor(stderr: string) {
      super("Docker daemon is not running");
      this.stderr = stderr;
      this.exitCode = 1;
    }
  }

  class MockDockerClient {
    async exec(args: string[]) {
      if (dockerExecImpl) return dockerExecImpl(args);
      return { stdout: "", stderr: "" };
    }
    async imageExists(_image: string) {
      return true;
    }
  }

  return {
    DockerClient: MockDockerClient,
    DaemonNotRunning: MockDaemonNotRunning,
  };
});

// Mock config loader
vi.mock("../config/loader.js", () => ({
  loadOpenClawConfig: vi.fn().mockResolvedValue({
    dangerouslyDisableDeviceAuth: true,
    allowedOrigins: ["http://localhost:18789"],
    trustedProxies: ["172.17.0.1"],
    tools: { exec: { host: "gateway", security: "full" } },
  }),
}));

// Mock config validator
vi.mock("../config/validator.js", () => ({
  validate: vi.fn().mockReturnValue([
    { rule: "LM-01", status: "pass", message: "OK", fix: "" },
  ]),
}));

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  access: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue("ANTHROPIC_API_KEY=sk-ant-test"),
}));

// Mock net.createServer for port check
vi.mock("node:net", () => {
  const createServer = vi.fn(() => {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    return {
      once(event: string, cb: (...args: unknown[]) => void) {
        listeners[event] = listeners[event] ?? [];
        listeners[event].push(cb);
      },
      listen(_port: number, _host: string) {
        // Simulate available port by default
        const cbs = listeners["listening"] ?? [];
        for (const cb of cbs) cb();
      },
      close(cb: () => void) {
        cb();
      },
    };
  });
  return { createServer };
});

// Mock global fetch for Ollama check
const mockFetch = vi.fn().mockRejectedValue(new Error("connection refused"));
vi.stubGlobal("fetch", mockFetch);

import { validate } from "../config/validator.js";
import { DaemonNotRunning } from "../docker/client.js";

import { runPreflight } from "./preflight.js";
import type { DeployOptions } from "./types.js";

function defaultOpts(): DeployOptions {
  return {
    openclawHome: "/tmp/openclaw",
    configPath: "/tmp/openclaw/openclaw.json",
    envPath: "/tmp/openclaw/.env",
    imageTag: "openclaw:custom",
    baseTag: "openclaw:local",
    gatewayPort: 18789,
  };
}

describe("runPreflight", () => {
  beforeEach(() => {
    dockerExecImpl = undefined;
    vi.mocked(validate).mockReturnValue([
      { rule: "LM-01", status: "pass", message: "OK", fix: "" },
    ]);
    vi.mocked(access).mockResolvedValue(undefined);
    mockFetch.mockRejectedValue(new Error("connection refused"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes when all checks succeed", async () => {
    dockerExecImpl = async () => ({ stdout: "ok", stderr: "" });

    const result = await runPreflight(defaultOpts());

    expect(result.passed).toBe(true);
    expect(result.steps.length).toBe(6);
    expect(result.steps.every((s) => s.status === "done")).toBe(true);
  });

  it("fails and aborts early when Docker daemon is down", async () => {
    dockerExecImpl = async () => {
      throw new DaemonNotRunning("not running");
    };

    const result = await runPreflight(defaultOpts());

    expect(result.passed).toBe(false);
    // Should abort after Docker check
    expect(result.steps.length).toBe(1);
    expect(result.steps[0].status).toBe("failed");
    expect(result.steps[0].message).toContain("Docker daemon is not running");
    expect(result.steps[0].message).toContain("Fix:");
  });

  it("fails when config validation finds errors", async () => {
    dockerExecImpl = async () => ({ stdout: "ok", stderr: "" });
    vi.mocked(validate).mockReturnValue([
      { rule: "LM-01", status: "fail", message: "Device auth not set", fix: "Set dangerouslyDisableDeviceAuth: true" },
    ]);

    const result = await runPreflight(defaultOpts());

    expect(result.passed).toBe(false);
    const configStep = result.steps.find((s) => s.name === "Config validation");
    expect(configStep?.status).toBe("failed");
    expect(configStep?.message).toContain("Config validation failed");
    expect(configStep?.message).toContain("Fix:");
  });

  it("fails when .env file is missing", async () => {
    dockerExecImpl = async () => ({ stdout: "ok", stderr: "" });
    vi.mocked(access).mockRejectedValue(new Error("ENOENT"));

    const result = await runPreflight(defaultOpts());

    expect(result.passed).toBe(false);
    const secretsStep = result.steps.find((s) => s.name === "Secrets file");
    expect(secretsStep?.status).toBe("failed");
    expect(secretsStep?.message).toContain("Fix:");
  });

  it("treats Ollama unreachable as non-blocking", async () => {
    dockerExecImpl = async () => ({ stdout: "ok", stderr: "" });
    mockFetch.mockRejectedValue(new Error("connection refused"));

    const result = await runPreflight(defaultOpts());

    // Should still pass overall
    expect(result.passed).toBe(true);
    const ollamaStep = result.steps.find((s) => s.name === "Ollama reachable");
    expect(ollamaStep?.status).toBe("done");
    expect(ollamaStep?.message).toContain("non-blocking");
  });

  it("reports Ollama as running when reachable", async () => {
    dockerExecImpl = async () => ({ stdout: "ok", stderr: "" });
    mockFetch.mockResolvedValue({ ok: true });

    const result = await runPreflight(defaultOpts());

    const ollamaStep = result.steps.find((s) => s.name === "Ollama reachable");
    expect(ollamaStep?.status).toBe("done");
    expect(ollamaStep?.message).toContain("Ollama is running");
  });

  it("each step has durationMs", async () => {
    dockerExecImpl = async () => ({ stdout: "ok", stderr: "" });

    const result = await runPreflight(defaultOpts());

    for (const step of result.steps) {
      expect(typeof step.durationMs).toBe("number");
      expect(step.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});

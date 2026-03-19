import { execFile } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkDocker, checkNode, checkOllama, detectPrereqs } from "./prereqs.js";

// ── Mock child_process ──────────────────────────────────────────────────────

type ExecCallback = (err: Error | null, stdout: string, stderr: string) => void;

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

const mockExecFile = vi.mocked(execFile);

/** Helper to make execFile succeed with stdout. */
function succeedsWith(stdout: string) {
  return (_cmd: string, _args: unknown, _opts: unknown, cb: ExecCallback) => {
    cb(null, stdout, "");
  };
}

/** Helper to make execFile fail. */
function fails() {
  return (_cmd: string, _args: unknown, _opts: unknown, cb: ExecCallback) => {
    cb(new Error("command not found"), "", "");
  };
}

beforeEach(() => {
  mockExecFile.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── checkDocker ─────────────────────────────────────────────────────────────

describe("checkDocker", () => {
  it("passes when docker daemon is reachable", async () => {
    mockExecFile.mockImplementation(succeedsWith("24.0.7") as never);

    const result = await checkDocker();

    expect(result.ok).toBe(true);
    expect(result.name).toBe("docker");
    expect(result.detail).toContain("24.0.7");
  });

  it("fails when docker CLI exists but daemon is down", async () => {
    // First call (docker version --format) fails, second (docker --version) succeeds
    let callCount = 0;
    mockExecFile.mockImplementation(((_cmd: string, _args: unknown, _opts: unknown, cb: ExecCallback) => {
      callCount++;
      if (callCount === 1) {
        cb(new Error("daemon not running"), "", "");
      } else {
        cb(null, "Docker version 24.0.7", "");
      }
    }) as never);

    const result = await checkDocker();

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("daemon is not running");
  });

  it("fails when docker is not installed", async () => {
    mockExecFile.mockImplementation(fails() as never);

    const result = await checkDocker();

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("not found");
  });
});

// ── checkNode ───────────────────────────────────────────────────────────────

describe("checkNode", () => {
  it("passes when node >= 22", async () => {
    mockExecFile.mockImplementation(succeedsWith("v22.5.0") as never);

    const result = await checkNode();

    expect(result.ok).toBe(true);
    expect(result.detail).toContain("22.5.0");
  });

  it("fails when node < 22", async () => {
    mockExecFile.mockImplementation(succeedsWith("v20.18.0") as never);

    const result = await checkNode();

    expect(result.ok).toBe(false);
    expect(result.detail).toContain(">=22 required");
  });

  it("fails when node is not installed", async () => {
    mockExecFile.mockImplementation(fails() as never);

    const result = await checkNode();

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("not found");
  });
});

// ── checkOllama ─────────────────────────────────────────────────────────────

describe("checkOllama", () => {
  it("passes when ollama is installed and running", async () => {
    mockExecFile.mockImplementation(succeedsWith("ollama version 0.1.32") as never);

    const result = await checkOllama();

    expect(result.ok).toBe(true);
    expect(result.detail).toContain("0.1.32");
  });

  it("fails when ollama CLI exists but server is down", async () => {
    let callCount = 0;
    mockExecFile.mockImplementation(((_cmd: string, _args: unknown, _opts: unknown, cb: ExecCallback) => {
      callCount++;
      if (callCount === 1) {
        // ollama --version succeeds
        cb(null, "ollama version 0.1.32", "");
      } else {
        // ollama list fails
        cb(new Error("server not running"), "", "");
      }
    }) as never);

    const result = await checkOllama();

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("not running");
  });

  it("fails when ollama is not installed", async () => {
    mockExecFile.mockImplementation(fails() as never);

    const result = await checkOllama();

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("not found");
  });
});

// ── detectPrereqs ───────────────────────────────────────────────────────────

describe("detectPrereqs", () => {
  it("passes when all checks pass", async () => {
    // Each check calls execFile multiple times — need realistic version strings
    mockExecFile.mockImplementation(((cmd: string, _args: string[], _opts: unknown, cb: ExecCallback) => {
      if (cmd === "docker") cb(null, "24.0.7", "");
      else if (cmd === "node") cb(null, "v22.5.0", "");
      else if (cmd === "ollama") cb(null, "ollama version 0.1.32", "");
      else cb(new Error("unknown"), "", "");
    }) as never);

    const report = await detectPrereqs();

    expect(report.passed).toBe(true);
    expect(report.checks).toHaveLength(3);
  });

  it("fails when any check fails", async () => {
    // Make all calls fail
    mockExecFile.mockImplementation(fails() as never);

    const report = await detectPrereqs();

    expect(report.passed).toBe(false);
  });
});

/**
 * Tests for the smoke runner. We don't spin a real container — docker
 * exec is mocked. The focus is on result shape (ok, exitCode, stderr
 * capture, duration) and the timeout/error paths.
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadToolSmokeState, runToolProbe, runToolSmoke, saveToolSmokeState } from "./runner.js";
import type { ToolSmokeProbeSpec, ToolSmokeState } from "./types.js";

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "clawhq-smoke-test-"));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// Mock exec that returns success or synthesises various error shapes.
// Error shape matches what child_process.execFile actually throws.
function makeExecError(fields: { message: string; code?: number | string; stderr?: string; killed?: boolean }): Error {
  const err = new Error(fields.message) as Error & Record<string, unknown>;
  if (fields.code !== undefined) err["code"] = fields.code;
  if (fields.stderr !== undefined) err["stderr"] = fields.stderr;
  if (fields.killed !== undefined) err["killed"] = fields.killed;
  return err;
}

function mockExec(outcome: "ok" | "fail" | "timeout" | "docker-missing") {
  return async (_cmd: string, _args: readonly string[]) => {
    if (outcome === "ok") return { stdout: "hello", stderr: "" };
    if (outcome === "fail") throw makeExecError({ message: "nonzero", code: 42, stderr: "boom: bad flag" });
    if (outcome === "timeout") throw makeExecError({ message: "killed", killed: true });
    throw makeExecError({ message: "docker not found", code: "ENOENT", stderr: "" });
  };
}

describe("runToolProbe", () => {
  const spec: ToolSmokeProbeSpec = { tool: "email", args: ["folders"], timeoutSec: 5 };

  it("returns ok + exit 0 on success", async () => {
    const result = await runToolProbe("openclaw-abc", spec, mockExec("ok") as never);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.tool).toBe("email");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns fail with captured exit code and stderr tail", async () => {
    const result = await runToolProbe("openclaw-abc", spec, mockExec("fail") as never);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(42);
    expect(result.stderr).toBe("boom: bad flag");
  });

  it("marks timeout as exitCode=-1", async () => {
    const result = await runToolProbe("openclaw-abc", spec, mockExec("timeout") as never);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(-1);
  });

  it("marks docker/system error as exitCode=-2", async () => {
    const result = await runToolProbe("openclaw-abc", spec, mockExec("docker-missing") as never);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(-2);
  });

  it("truncates long stderr to 200 chars", async () => {
    const exec = async () => {
      throw makeExecError({ message: "long", code: 1, stderr: "x".repeat(500) });
    };
    const result = await runToolProbe("openclaw-abc", spec, exec as never);
    expect(result.stderr.length).toBe(200);
  });
});

describe("runToolSmoke", () => {
  it("aggregates per-tool results and computes failCount", async () => {
    const specs: ToolSmokeProbeSpec[] = [
      { tool: "email", args: ["--help"], timeoutSec: 5 },
      { tool: "tasks", args: ["--help"], timeoutSec: 5 },
    ];
    let call = 0;
    const exec = (async () => {
      call += 1;
      if (call === 1) return { stdout: "", stderr: "" };
      throw makeExecError({ message: "fail", code: 3, stderr: "nope" });
    }) as never;

    const report = await runToolSmoke("openclaw-abc", specs, exec);
    expect(report.results).toHaveLength(2);
    expect(report.results[0]?.ok).toBe(true);
    expect(report.results[1]?.ok).toBe(false);
    expect(report.failCount).toBe(1);
    expect(report.container).toBe("openclaw-abc");
    expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("saveToolSmokeState / loadToolSmokeState", () => {
  it("round-trips a state through the ops/smoke/state.json path", () => {
    const state: ToolSmokeState = {
      lastReport: {
        timestamp: "2026-04-24T01:23:45.000Z",
        container: "openclaw-abc",
        results: [{ tool: "email", ok: true, exitCode: 0, stderr: "", durationMs: 100 }],
        failCount: 0,
      },
      streaks: { email: 0 },
    };
    saveToolSmokeState(testDir, state);
    const loaded = loadToolSmokeState(testDir);
    expect(loaded).toEqual(state);
  });

  it("returns undefined when no state file exists", () => {
    expect(loadToolSmokeState(testDir)).toBeUndefined();
  });

  it("returns undefined on a corrupt state file (graceful recovery)", () => {
    mkdirSync(join(testDir, "ops", "tool-smoke"), { recursive: true });
    writeFileSync(join(testDir, "ops", "tool-smoke", "state.json"), "not-json", "utf-8");
    expect(loadToolSmokeState(testDir)).toBeUndefined();
  });

  it("persists atomically via a tmp+rename (no partial writes visible)", () => {
    const state: ToolSmokeState = {
      lastReport: {
        timestamp: "2026-04-24T02:00:00.000Z",
        container: "openclaw-abc",
        results: [],
        failCount: 0,
      },
      streaks: {},
    };
    saveToolSmokeState(testDir, state);
    // After save, no .tmp file should remain.
    const entries = readdirSync(join(testDir, "ops", "tool-smoke"));
    expect(entries).toContain("state.json");
    expect(entries.some((e) => e.endsWith(".tmp"))).toBe(false);
    // File is valid JSON.
    const raw = readFileSync(join(testDir, "ops", "tool-smoke", "state.json"), "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});

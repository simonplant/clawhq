import { describe, expect, it } from "vitest";

import { formatJson, formatTable, runChecks } from "./runner.js";
import type { Check, CheckResult, DoctorContext } from "./types.js";

function makeCtx(overrides: Partial<DoctorContext> = {}): DoctorContext {
  return {
    openclawHome: "/tmp/openclaw",
    configPath: "/tmp/openclaw/openclaw.json",
    ...overrides,
  };
}

function makeCheck(name: string, result: Omit<CheckResult, "name">): Check {
  return {
    name,
    async run() {
      return { name, ...result };
    },
  };
}

describe("runChecks", () => {
  it("runs all checks and aggregates results", async () => {
    const checks = [
      makeCheck("check-a", { status: "pass", message: "OK", fix: "" }),
      makeCheck("check-b", { status: "warn", message: "Maybe", fix: "Do something" }),
      makeCheck("check-c", { status: "fail", message: "Bad", fix: "Fix it" }),
    ];

    const report = await runChecks(makeCtx(), checks);

    expect(report.checks).toHaveLength(3);
    expect(report.counts).toEqual({ pass: 1, warn: 1, fail: 1 });
    expect(report.passed).toBe(false);
  });

  it("reports passed when no failures", async () => {
    const checks = [
      makeCheck("check-a", { status: "pass", message: "OK", fix: "" }),
      makeCheck("check-b", { status: "warn", message: "Maybe", fix: "" }),
    ];

    const report = await runChecks(makeCtx(), checks);

    expect(report.passed).toBe(true);
    expect(report.counts).toEqual({ pass: 1, warn: 1, fail: 0 });
  });

  it("catches checks that throw and records as fail", async () => {
    const throwingCheck: Check = {
      name: "thrower",
      async run() {
        throw new Error("boom");
      },
    };

    const report = await runChecks(makeCtx(), [throwingCheck]);

    expect(report.checks).toHaveLength(1);
    expect(report.checks[0].status).toBe("fail");
    expect(report.checks[0].message).toContain("boom");
  });

  it("returns all pass with empty check list", async () => {
    const report = await runChecks(makeCtx(), []);

    expect(report.checks).toHaveLength(0);
    expect(report.passed).toBe(true);
    expect(report.counts).toEqual({ pass: 0, warn: 0, fail: 0 });
  });
});

describe("formatTable", () => {
  it("formats a readable table with header and summary", () => {
    const report = {
      checks: [
        { name: "Docker daemon", status: "pass" as const, message: "Running", fix: "" },
        { name: "Port check", status: "warn" as const, message: "In use", fix: "Check port" },
        { name: "Config", status: "fail" as const, message: "Invalid", fix: "Fix config" },
      ],
      passed: false,
      counts: { pass: 1, warn: 1, fail: 1 },
    };

    const output = formatTable(report);

    expect(output).toContain("CHECK");
    expect(output).toContain("STATUS");
    expect(output).toContain("MESSAGE");
    expect(output).toContain("Docker daemon");
    expect(output).toContain("PASS");
    expect(output).toContain("WARN");
    expect(output).toContain("FAIL");
    expect(output).toContain("1 passed, 1 warnings, 1 failed");
  });
});

describe("formatJson", () => {
  it("outputs valid JSON", () => {
    const report = {
      checks: [{ name: "test", status: "pass" as const, message: "OK", fix: "" }],
      passed: true,
      counts: { pass: 1, warn: 0, fail: 0 },
    };

    const output = formatJson(report);
    const parsed = JSON.parse(output);

    expect(parsed.passed).toBe(true);
    expect(parsed.checks).toHaveLength(1);
    expect(parsed.counts.pass).toBe(1);
  });
});

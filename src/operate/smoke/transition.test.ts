/**
 * Tests for smoke-test state-transition detection. Pure logic, no I/O.
 *
 * The three invariants we lock in:
 *   1. A tool that flips from ok → fail produces exactly one "new-failure" event.
 *   2. A tool that flips from fail → ok produces a "recovered" event and resets streak.
 *   3. A tool that stays failing does not re-notify on every tick — only at streak
 *      milestones (10, 100, 1000) via the "still-failing-notify" event.
 */

import { describe, expect, it } from "vitest";

import { detectTransitions, formatTransitionsForTelegram } from "./transition.js";
import type { SmokeReport, SmokeResult, SmokeState } from "./types.js";

function ok(tool: string): SmokeResult {
  return { tool, ok: true, exitCode: 0, stderr: "", durationMs: 120 };
}
function fail(tool: string, stderr = "boom"): SmokeResult {
  return { tool, ok: false, exitCode: 1, stderr, durationMs: 400 };
}
function report(results: SmokeResult[]): SmokeReport {
  return {
    timestamp: "2026-04-24T00:00:00.000Z",
    container: "openclaw-test",
    results,
    failCount: results.filter((r) => !r.ok).length,
  };
}

describe("detectTransitions", () => {
  it("first-ever run: every failure is reported as new-failure", () => {
    const { transitions, streaks } = detectTransitions(
      report([ok("email"), fail("tasks", "401")]),
      undefined,
    );
    expect(transitions).toHaveLength(1);
    expect(transitions[0]?.tool).toBe("tasks");
    expect(transitions[0]?.kind).toBe("new-failure");
    expect(transitions[0]?.reason).toBe("401");
    expect(transitions[0]?.streakCount).toBe(1);
    expect(streaks["tasks"]).toBe(1);
    expect(streaks["email"]).toBe(0);
  });

  it("ok → ok: no transition, no streak", () => {
    const prev: SmokeState = { lastReport: report([ok("email")]), streaks: { email: 0 } };
    const { transitions, streaks } = detectTransitions(report([ok("email")]), prev);
    expect(transitions).toHaveLength(0);
    expect(streaks["email"]).toBe(0);
  });

  it("ok → fail: emits new-failure with streak=1", () => {
    const prev: SmokeState = { lastReport: report([ok("email")]), streaks: { email: 0 } };
    const { transitions, streaks } = detectTransitions(report([fail("email", "imap down")]), prev);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]?.kind).toBe("new-failure");
    expect(transitions[0]?.reason).toBe("imap down");
    expect(streaks["email"]).toBe(1);
  });

  it("fail → ok: emits recovered and resets streak", () => {
    const prev: SmokeState = { lastReport: report([fail("email")]), streaks: { email: 7 } };
    const { transitions, streaks } = detectTransitions(report([ok("email")]), prev);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]?.kind).toBe("recovered");
    expect(transitions[0]?.tool).toBe("email");
    expect(streaks["email"]).toBe(0);
  });

  it("fail → fail below milestone: silent (no transition), streak increments", () => {
    const prev: SmokeState = { lastReport: report([fail("email")]), streaks: { email: 3 } };
    const { transitions, streaks } = detectTransitions(report([fail("email")]), prev);
    expect(transitions).toHaveLength(0);
    expect(streaks["email"]).toBe(4);
  });

  it("fail → fail at streak=10: emits still-failing-notify", () => {
    const prev: SmokeState = { lastReport: report([fail("email")]), streaks: { email: 9 } };
    const { transitions, streaks } = detectTransitions(report([fail("email", "still broken")]), prev);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]?.kind).toBe("still-failing-notify");
    expect(transitions[0]?.streakCount).toBe(10);
    expect(streaks["email"]).toBe(10);
  });

  it("fail → fail between milestones: silent", () => {
    const prev: SmokeState = { lastReport: report([fail("email")]), streaks: { email: 10 } };
    const { transitions } = detectTransitions(report([fail("email")]), prev);
    expect(transitions).toHaveLength(0);
  });

  it("fail → fail at streak=100: emits still-failing-notify again", () => {
    const prev: SmokeState = { lastReport: report([fail("email")]), streaks: { email: 99 } };
    const { transitions } = detectTransitions(report([fail("email")]), prev);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]?.streakCount).toBe(100);
  });

  it("multiple tools with mixed transitions in one run", () => {
    const prev: SmokeState = {
      lastReport: report([ok("email"), fail("tasks"), fail("x")]),
      streaks: { email: 0, tasks: 5, x: 1 },
    };
    const { transitions, streaks } = detectTransitions(
      report([fail("email", "new"), ok("tasks"), fail("x", "still")]),
      prev,
    );
    // email: ok→fail, tasks: fail→ok, x: fail→fail below milestone
    expect(transitions.map((t) => [t.tool, t.kind]).sort()).toEqual([
      ["email", "new-failure"],
      ["tasks", "recovered"],
    ]);
    expect(streaks).toEqual({ email: 1, tasks: 0, x: 2 });
  });

  it("tool missing from previous report is treated as previously-ok", () => {
    // New tool appears in the current run, never seen before. Should
    // be reported as new-failure if it fails, silent if it passes.
    const prev: SmokeState = { lastReport: report([ok("email")]), streaks: { email: 0 } };
    const { transitions } = detectTransitions(report([ok("email"), fail("new-tool")]), prev);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]?.tool).toBe("new-tool");
    expect(transitions[0]?.kind).toBe("new-failure");
  });
});

describe("formatTransitionsForTelegram", () => {
  it("returns empty string on no transitions", () => {
    expect(formatTransitionsForTelegram([], "openclaw-abc")).toBe("");
  });

  it("groups failures and recoveries, shows streaks when > 1", () => {
    const msg = formatTransitionsForTelegram(
      [
        { tool: "email", kind: "new-failure", reason: "auth 401" },
        { tool: "tasks", kind: "still-failing-notify", reason: "API 500", streakCount: 10 },
        { tool: "x", kind: "recovered" },
      ],
      "openclaw-abc",
    );
    expect(msg).toContain("2 failing on `openclaw-abc`");
    expect(msg).toContain("`email`");
    expect(msg).toContain("auth 401");
    expect(msg).toContain("`tasks`");
    expect(msg).toContain("streak: 10");
    expect(msg).toContain("Recovered — 1");
    expect(msg).toContain("`x`");
  });

  it("truncates long stderr to keep telegram messages compact", () => {
    const longReason = "x".repeat(500);
    const msg = formatTransitionsForTelegram(
      [{ tool: "email", kind: "new-failure", reason: longReason }],
      "c",
    );
    // 80-char slice plus the leading ` — `
    const emailLine = msg.split("\n").find((l) => l.includes("`email`")) ?? "";
    const xCount = (emailLine.match(/x/g) ?? []).length;
    expect(xCount).toBe(80);
  });
});

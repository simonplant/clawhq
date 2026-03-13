import { describe, expect, it } from "vitest";

import { runFixes } from "./fix.js";
import type { Check, CheckResult, DoctorContext, FixableCheck, FixResult } from "./types.js";

function makeCtx(): DoctorContext {
  return {
    openclawHome: "/tmp/openclaw",
    configPath: "/tmp/openclaw/openclaw.json",
  };
}

describe("runFixes", () => {
  it("only runs fixes on fixable checks", async () => {
    const normalCheck: Check = {
      name: "normal",
      async run(): Promise<CheckResult> {
        return { name: "normal", status: "fail", message: "bad", fix: "" };
      },
    };

    const fixableCheck: FixableCheck = {
      name: "fixable",
      async run(): Promise<CheckResult> {
        return { name: "fixable", status: "fail", message: "bad", fix: "" };
      },
      async fix(): Promise<FixResult> {
        return { name: "fixable", fixed: true, message: "Fixed!" };
      },
    };

    const results = await runFixes(makeCtx(), [normalCheck, fixableCheck]);

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("fixable");
    expect(results[0].fixed).toBe(true);
  });

  it("catches fix errors", async () => {
    const failingFix: FixableCheck = {
      name: "failing",
      async run(): Promise<CheckResult> {
        return { name: "failing", status: "fail", message: "bad", fix: "" };
      },
      async fix(): Promise<FixResult> {
        throw new Error("fix boom");
      },
    };

    const results = await runFixes(makeCtx(), [failingFix]);

    expect(results).toHaveLength(1);
    expect(results[0].fixed).toBe(false);
    expect(results[0].message).toContain("fix boom");
  });

  it("returns empty when no fixable checks", async () => {
    const normalCheck: Check = {
      name: "normal",
      async run(): Promise<CheckResult> {
        return { name: "normal", status: "pass", message: "ok", fix: "" };
      },
    };

    const results = await runFixes(makeCtx(), [normalCheck]);

    expect(results).toHaveLength(0);
  });
});

import { describe, expect, it } from "vitest";

import { classifyNotify } from "./pipeline.js";
import type { RiskDecision } from "./types.js";

const NO_DECISION: RiskDecision = { scope: "advisory-only" };

describe("classifyNotify", () => {
  it("is loud for stop hits regardless of conviction", () => {
    expect(
      classifyNotify({
        levelName: "stop",
        conviction: "LOW",
        decision: NO_DECISION,
      }),
    ).toBe("loud");
  });

  it("is loud for target hits", () => {
    for (const level of ["t1", "t2"] as const) {
      expect(
        classifyNotify({
          levelName: level,
          conviction: "LOW",
          decision: NO_DECISION,
        }),
      ).toBe("loud");
    }
  });

  it("is loud for HIGH conviction entries", () => {
    expect(
      classifyNotify({
        levelName: "entry",
        conviction: "HIGH",
        decision: NO_DECISION,
      }),
    ).toBe("loud");
  });

  it("is loud when governor blocks or warns", () => {
    expect(
      classifyNotify({
        levelName: "entry",
        conviction: "LOW",
        decision: { scope: "tradier-strict", block: "cap exceeded" },
      }),
    ).toBe("loud");
    expect(
      classifyNotify({
        levelName: "entry",
        conviction: "LOW",
        decision: { scope: "advisory-only", warn: "cross-account concentration" },
      }),
    ).toBe("loud");
  });

  it("is quiet for a MEDIUM entry crossing with no special signals", () => {
    expect(
      classifyNotify({
        levelName: "entry",
        conviction: "MEDIUM",
        decision: NO_DECISION,
      }),
    ).toBe("quiet");
  });

  it("is quiet for LOW conviction entries with no special signals", () => {
    expect(
      classifyNotify({
        levelName: "entry",
        conviction: "LOW",
        decision: NO_DECISION,
      }),
    ).toBe("quiet");
  });
});

import { describe, expect, it } from "vitest";

import { classifyNotify } from "./pipeline.js";
import type { ConfluenceSnapshot, RiskDecision } from "./types.js";

const NO_DECISION: RiskDecision = { scope: "advisory-only" };

function alignedHigh(): ConfluenceSnapshot {
  return { tier: "strong-aligned", score: 75, label: "dp+mancini all HIGH" };
}

function divergent(): ConfluenceSnapshot {
  return { tier: "divergent", score: 25, label: "divergence vs scanner" };
}

function singleSource(): ConfluenceSnapshot {
  return { tier: "none", score: 50, label: "single-source" };
}

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

  it("is loud for divergent or strong-aligned confluence", () => {
    expect(
      classifyNotify({
        levelName: "entry",
        conviction: "MEDIUM",
        decision: NO_DECISION,
        confluence: divergent(),
      }),
    ).toBe("loud");
    expect(
      classifyNotify({
        levelName: "entry",
        conviction: "MEDIUM",
        decision: NO_DECISION,
        confluence: alignedHigh(),
      }),
    ).toBe("loud");
  });

  it("is quiet for a MEDIUM single-source entry crossing", () => {
    expect(
      classifyNotify({
        levelName: "entry",
        conviction: "MEDIUM",
        decision: NO_DECISION,
        confluence: singleSource(),
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

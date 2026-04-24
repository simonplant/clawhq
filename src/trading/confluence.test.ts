import { describe, expect, it } from "vitest";

import {
  alertBadge,
  computeConfluence,
  qualityFromAggregates,
  rankByConfluence,
} from "./confluence.js";
import type { OrderBlock } from "./types.js";

function mkOrder(overrides: Partial<OrderBlock> & { id: string }): OrderBlock {
  return {
    id: overrides.id,
    sequence: 1,
    source: "scanner",
    accounts: ["tos"],
    ticker: "AAPL",
    execAs: "AAPL",
    direction: "LONG",
    setup: "",
    why: "",
    entry: 170,
    entryOrderType: "LMT",
    stop: 165,
    stopSource: "",
    t1: 175,
    t1Source: "",
    t2: 180,
    t2Source: "",
    runner: "",
    riskPerShare: 5,
    quantity: 10,
    totalRisk: 50,
    confirmation: "PENDING_TA",
    conviction: "MEDIUM",
    confluence: "none",
    caveat: "none",
    kills: [],
    activation: "immediate",
    verify: "none",
    status: "ACTIVE",
    ...overrides,
  };
}

describe("computeConfluence", () => {
  it("flags single-source orders as tier=none with baseline 50 score", () => {
    const orders = [mkOrder({ id: "a", source: "dp", ticker: "AMZN", entry: 240 })];
    const findings = computeConfluence(orders);
    expect(findings.get("a")?.tier).toBe("none");
    expect(findings.get("a")?.score).toBe(50);
  });

  it("flags aligned DP+MANCINI on the same ticker + direction + nearby entry", () => {
    const orders = [
      mkOrder({ id: "a", source: "dp", ticker: "SPY", entry: 570, direction: "LONG" }),
      mkOrder({ id: "b", source: "mancini", ticker: "SPY", entry: 571, direction: "LONG", sequence: 2 }),
    ];
    const findings = computeConfluence(orders);
    expect(findings.get("a")?.tier).toBe("aligned");
    expect(findings.get("a")?.sources).toEqual(["dp", "mancini"]);
    expect(findings.get("a")?.score).toBe(65);
    expect(findings.get("b")?.tier).toBe("aligned");
  });

  it("flags strong-aligned when every contributor is HIGH conviction", () => {
    const orders = [
      mkOrder({ id: "a", source: "dp", ticker: "NVDA", entry: 120, conviction: "HIGH" }),
      mkOrder({ id: "b", source: "mancini", ticker: "NVDA", entry: 120.5, conviction: "HIGH", sequence: 2 }),
    ];
    const findings = computeConfluence(orders);
    expect(findings.get("a")?.tier).toBe("strong-aligned");
    expect(findings.get("a")?.score).toBe(75);
    expect(findings.get("a")?.label).toMatch(/all HIGH/);
  });

  it("flags divergent when same ticker from different sources has opposite directions", () => {
    const orders = [
      mkOrder({ id: "a", source: "dp", ticker: "META", entry: 500, direction: "LONG" }),
      mkOrder({ id: "b", source: "scanner", ticker: "META", entry: 498, direction: "SHORT", sequence: 2 }),
    ];
    const findings = computeConfluence(orders);
    expect(findings.get("a")?.tier).toBe("divergent");
    expect(findings.get("a")?.score).toBe(25);
    expect(findings.get("a")?.label).toMatch(/divergence/);
  });

  it("does not count same-source peers as alignment", () => {
    const orders = [
      mkOrder({ id: "a", source: "dp", ticker: "QQQ", entry: 480 }),
      mkOrder({ id: "b", source: "dp", ticker: "QQQ", entry: 481, sequence: 2 }),
    ];
    const findings = computeConfluence(orders);
    expect(findings.get("a")?.tier).toBe("none");
    expect(findings.get("b")?.tier).toBe("none");
  });

  it("does not count far-apart entries as aligned", () => {
    // 170 vs 175 is ~2.9% apart; alignment threshold is 1%.
    const orders = [
      mkOrder({ id: "a", source: "dp", ticker: "AAPL", entry: 170 }),
      mkOrder({ id: "b", source: "mancini", ticker: "AAPL", entry: 175, sequence: 2 }),
    ];
    const findings = computeConfluence(orders);
    expect(findings.get("a")?.tier).toBe("none");
  });

  it("flags divergent even when entries are far apart (wider divergence band)", () => {
    // Opposite-direction check uses 5% band; 170 vs 178 = ~4.7%.
    const orders = [
      mkOrder({ id: "a", source: "dp", ticker: "AAPL", entry: 170, direction: "LONG" }),
      mkOrder({ id: "b", source: "mancini", ticker: "AAPL", entry: 178, direction: "SHORT", sequence: 2 }),
    ];
    const findings = computeConfluence(orders);
    expect(findings.get("a")?.tier).toBe("divergent");
  });

  it("prefers divergent over aligned when both peers exist", () => {
    // DP+MANCINI aligned LONG, but a scanner flags SHORT — the warning matters.
    const orders = [
      mkOrder({ id: "a", source: "dp", ticker: "TSLA", entry: 250, direction: "LONG" }),
      mkOrder({ id: "b", source: "mancini", ticker: "TSLA", entry: 250.5, direction: "LONG", sequence: 2 }),
      mkOrder({ id: "c", source: "scanner", ticker: "TSLA", entry: 249, direction: "SHORT", sequence: 3 }),
    ];
    const findings = computeConfluence(orders);
    expect(findings.get("a")?.tier).toBe("divergent");
  });

  it("scales score with number of aligned sources", () => {
    const orders = [
      mkOrder({ id: "a", source: "dp", ticker: "SPY", entry: 570 }),
      mkOrder({ id: "b", source: "mancini", ticker: "SPY", entry: 570.5, sequence: 2 }),
      mkOrder({ id: "c", source: "focus25", ticker: "SPY", entry: 571, sequence: 3 }),
    ];
    const findings = computeConfluence(orders);
    // 3 sources aligned → 65 + 15*(3-2) = 80
    expect(findings.get("a")?.score).toBe(80);
  });
});

describe("rankByConfluence", () => {
  it("sorts orders by descending score, stable on ties by sequence", () => {
    const orders = [
      mkOrder({ id: "a", source: "dp", ticker: "AAPL", entry: 170, sequence: 1 }), // single-source → 50
      mkOrder({ id: "b", source: "dp", ticker: "NVDA", entry: 120, conviction: "HIGH", sequence: 2 }),
      mkOrder({ id: "c", source: "mancini", ticker: "NVDA", entry: 120.5, conviction: "HIGH", sequence: 3 }), // strong-aligned → 75
      mkOrder({ id: "d", source: "scanner", ticker: "TSLA", entry: 250, sequence: 4 }), // single → 50
    ];
    const findings = computeConfluence(orders);
    const ranked = rankByConfluence(orders, findings);
    expect(ranked.map((o) => o.id)).toEqual(["b", "c", "a", "d"]);
  });
});

describe("quality-adjusted computeConfluence", () => {
  it("scales aligned score down when sources have poor quality", () => {
    const orders = [
      mkOrder({ id: "a", source: "dp", ticker: "SPY", entry: 570 }),
      mkOrder({ id: "b", source: "mancini", ticker: "SPY", entry: 571, sequence: 2 }),
    ];
    const base = computeConfluence(orders);
    const adjusted = computeConfluence(orders, {
      sourceQuality: { dp: 0.9, mancini: 0.9 },
    });
    expect(base.get("a")?.score).toBe(65);
    // 65 × 0.9 × 0.9 = 52.65 → 53
    expect(adjusted.get("a")?.score).toBe(53);
  });

  it("scales aligned score up when sources have strong quality", () => {
    const orders = [
      mkOrder({ id: "a", source: "dp", ticker: "SPY", entry: 570 }),
      mkOrder({ id: "b", source: "mancini", ticker: "SPY", entry: 571, sequence: 2 }),
    ];
    const adjusted = computeConfluence(orders, {
      sourceQuality: { dp: 1.1, mancini: 1.1 },
    });
    // 65 × 1.1 × 1.1 = 78.65 → 79
    expect(adjusted.get("a")?.score).toBe(79);
  });

  it("clamps quality multiplier to [0.85, 1.15]", () => {
    const orders = [
      mkOrder({ id: "a", source: "dp", ticker: "SPY", entry: 570 }),
      mkOrder({ id: "b", source: "mancini", ticker: "SPY", entry: 571, sequence: 2 }),
    ];
    const adjusted = computeConfluence(orders, {
      sourceQuality: { dp: 3.0, mancini: 0.1 }, // outside band
    });
    // Clamped to 1.15 × 0.85 = 0.9775; 65 × 0.9775 = 63.54 → 64
    expect(adjusted.get("a")?.score).toBe(64);
  });

  it("does not adjust strong-aligned (HIGH conviction stays sovereign)", () => {
    const orders = [
      mkOrder({ id: "a", source: "dp", ticker: "NVDA", entry: 120, conviction: "HIGH" }),
      mkOrder({
        id: "b",
        source: "mancini",
        ticker: "NVDA",
        entry: 120.5,
        conviction: "HIGH",
        sequence: 2,
      }),
    ];
    const adjusted = computeConfluence(orders, {
      sourceQuality: { dp: 0.85, mancini: 0.85 },
    });
    expect(adjusted.get("a")?.tier).toBe("strong-aligned");
    expect(adjusted.get("a")?.score).toBe(75); // unchanged
  });

  it("does not adjust divergent findings", () => {
    const orders = [
      mkOrder({ id: "a", source: "dp", ticker: "META", entry: 500, direction: "LONG" }),
      mkOrder({
        id: "b",
        source: "scanner",
        ticker: "META",
        entry: 498,
        direction: "SHORT",
        sequence: 2,
      }),
    ];
    const adjusted = computeConfluence(orders, {
      sourceQuality: { dp: 1.15, scanner: 1.15 },
    });
    expect(adjusted.get("a")?.score).toBe(25); // unchanged
  });
});

describe("qualityFromAggregates", () => {
  it("returns empty when sample sizes are below threshold", () => {
    const q = qualityFromAggregates([
      { key: { source: "dp" }, wins: 2, losses: 1, winRate: 2 / 3 },
    ]);
    expect(q).toEqual({});
  });

  it("promotes sources with high win-rate + enough samples", () => {
    const q = qualityFromAggregates([
      { key: { source: "dp" }, wins: 7, losses: 3, winRate: 0.7 },
    ]);
    expect(q).toEqual({ dp: 1.1 });
  });

  it("demotes sources with low win-rate + enough samples", () => {
    const q = qualityFromAggregates([
      { key: { source: "mancini" }, wins: 3, losses: 10, winRate: 0.23 },
    ]);
    expect(q).toEqual({ mancini: 0.9 });
  });

  it("aggregates per-source across convictions", () => {
    const q = qualityFromAggregates([
      { key: { source: "dp" }, wins: 4, losses: 2, winRate: 0.67 },
      { key: { source: "dp" }, wins: 4, losses: 2, winRate: 0.67 },
    ]);
    // 8 wins, 4 losses → 0.67 → promote
    expect(q).toEqual({ dp: 1.1 });
  });
});

describe("alertBadge", () => {
  it("returns a loud warning badge for divergent, silent for none", () => {
    expect(alertBadge("divergent")).toMatch(/DIVERGENT/);
    expect(alertBadge("strong-aligned")).toMatch(/STRONG-ALIGNED/);
    expect(alertBadge("aligned")).toMatch(/ALIGNED/);
    expect(alertBadge("none")).toBe("");
  });
});

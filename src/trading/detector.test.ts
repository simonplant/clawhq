import { describe, expect, it } from "vitest";

import {
  classifyCrossing,
  distanceFraction,
  makeLevelDetector,
  proximityFor,
} from "./detector.js";
import type { OrderBlock, PriceQuote } from "./types.js";

function mkOrder(overrides: Partial<OrderBlock> = {}): OrderBlock {
  return {
    id: "mancini-ES-deadbeef",
    sequence: 1,
    source: "mancini",
    accounts: ["tos"],
    ticker: "ES",
    execAs: "/MES",
    direction: "LONG",
    setup: "FB",
    why: "",
    entry: 7090,
    entryOrderType: "LMT",
    stop: 7078,
    stopSource: "flush-4",
    t1: 7105,
    t1Source: "next R",
    t2: 7120,
    t2Source: "next R",
    runner: "",
    riskPerShare: 12,
    quantity: 2,
    totalRisk: 120,
    confirmation: "CONFIRMED",
    conviction: "HIGH",
    confluence: "none",
    caveat: "none",
    kills: [],
    activation: "immediate",
    verify: "none",
    status: "ACTIVE",
    ...overrides,
  };
}

function mkQuote(symbol: string, last: number): PriceQuote {
  return {
    symbol,
    last,
    bid: last,
    ask: last,
    tsMs: 0,
    receivedMs: 0,
  };
}

describe("classifyCrossing", () => {
  it("detects UP cross", () => {
    expect(classifyCrossing(7019, 7023, 7020)).toBe("UP");
  });
  it("detects DOWN cross", () => {
    expect(classifyCrossing(7023, 7019, 7020)).toBe("DOWN");
  });
  it("returns null when level not crossed", () => {
    expect(classifyCrossing(7019, 7019.5, 7020)).toBeNull();
    expect(classifyCrossing(7021, 7022, 7020)).toBeNull();
  });
  it("treats equality on the level as a cross boundary", () => {
    expect(classifyCrossing(7019, 7020, 7020)).toBe("UP");
    expect(classifyCrossing(7021, 7020, 7020)).toBe("DOWN");
  });
});

describe("distanceFraction + proximityFor", () => {
  it("computes fractional distance", () => {
    expect(distanceFraction(101, 100)).toBeCloseTo(0.01);
    expect(distanceFraction(100, 100)).toBe(0);
  });
  it("classifies entry proximity", () => {
    // <= 0.15% = AT, <= 0.50% = NEAR, <= 1.50% = APPROACHING
    expect(proximityFor("entry", 7090.05, 7090)).toBe("AT");
    expect(proximityFor("entry", 7115, 7090)).toBe("NEAR"); // 0.35% distance
    expect(proximityFor("entry", 7180, 7090)).toBe("APPROACHING"); // 1.27%
  });
  it("uses tighter thresholds for stop and targets", () => {
    // 0.50% is NEAR for entry; stop/target need to be within 0.30%.
    expect(proximityFor("entry", 100.5, 100)).toBe("NEAR");
    expect(proximityFor("stop", 100.2, 100)).toBe("STOP");
    expect(proximityFor("t1", 100.2, 100)).toBe("TARGET");
    // Further away, stop/target fall into APPROACHING.
    expect(proximityFor("stop", 100.5, 100)).toBe("APPROACHING");
  });
});

describe("makeLevelDetector", () => {
  it("never emits on the first poll (no prev price)", () => {
    const d = makeLevelDetector({ monotonicNowMs: () => 0 });
    const order = mkOrder();
    const hits = d.ingest([mkQuote("ES", 7085)], [order]);
    expect(hits).toEqual([]);
  });

  it("emits LevelHit when price crosses entry UP", () => {
    const d = makeLevelDetector({ monotonicNowMs: () => 0 });
    const order = mkOrder();
    d.ingest([mkQuote("ES", 7085)], [order]); // seed
    const hits = d.ingest([mkQuote("ES", 7092)], [order]);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.levelName).toBe("entry");
    expect(hits[0]?.crossingDirection).toBe("UP");
    expect(hits[0]?.prevPrice).toBe(7085);
    expect(hits[0]?.currentPrice).toBe(7092);
  });

  it("emits on stop cross DOWN with STOP proximity", () => {
    const d = makeLevelDetector({ monotonicNowMs: () => 0 });
    const order = mkOrder();
    d.ingest([mkQuote("ES", 7082)], [order]); // seed
    const hits = d.ingest([mkQuote("ES", 7077)], [order]);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.levelName).toBe("stop");
    expect(hits[0]?.proximity).toBe("STOP");
  });

  it("dedupes repeated crosses within TTL", () => {
    let t = 0;
    const d = makeLevelDetector({ dedupTtlMs: 60_000, monotonicNowMs: () => t });
    const order = mkOrder();
    d.ingest([mkQuote("ES", 7085)], [order]);
    t = 1_000;
    const first = d.ingest([mkQuote("ES", 7092)], [order]);
    t = 2_000;
    d.ingest([mkQuote("ES", 7085)], [order]); // drop back
    t = 3_000;
    const second = d.ingest([mkQuote("ES", 7092)], [order]); // cross UP again
    expect(first).toHaveLength(1);
    expect(second).toEqual([]); // still within TTL
  });

  it("emits again after TTL expires", () => {
    let t = 0;
    const d = makeLevelDetector({ dedupTtlMs: 60_000, monotonicNowMs: () => t });
    const order = mkOrder();
    d.ingest([mkQuote("ES", 7085)], [order]);
    t = 1_000;
    d.ingest([mkQuote("ES", 7092)], [order]);
    t = 70_000;
    d.ingest([mkQuote("ES", 7085)], [order]);
    t = 71_000;
    const hits = d.ingest([mkQuote("ES", 7092)], [order]);
    expect(hits).toHaveLength(1);
  });

  it("separate dedup keys for UP vs DOWN on the same level", () => {
    let t = 0;
    const d = makeLevelDetector({ dedupTtlMs: 60_000, monotonicNowMs: () => t });
    const order = mkOrder();
    d.ingest([mkQuote("ES", 7085)], [order]); // seed
    t = 1_000;
    const up = d.ingest([mkQuote("ES", 7092)], [order]);
    t = 2_000;
    const down = d.ingest([mkQuote("ES", 7085)], [order]); // DOWN cross
    expect(up).toHaveLength(1);
    expect(up[0]?.crossingDirection).toBe("UP");
    expect(down).toHaveLength(1);
    expect(down[0]?.crossingDirection).toBe("DOWN");
  });

  it("ignores closed / killed orders", () => {
    const d = makeLevelDetector({ monotonicNowMs: () => 0 });
    const closed = mkOrder({ status: "CLOSED" });
    const killed = mkOrder({ status: "KILLED", id: "mancini-ES-dead2" });
    d.ingest([mkQuote("ES", 7085)], [closed, killed]);
    const hits = d.ingest([mkQuote("ES", 7092)], [closed, killed]);
    expect(hits).toEqual([]);
  });

  it("matches orders to quotes by uppercased ticker", () => {
    const d = makeLevelDetector({ monotonicNowMs: () => 0 });
    const dpOrder = mkOrder({
      id: "dp-META-1",
      source: "dp",
      ticker: "META",
      execAs: "META",
      entry: 680,
      stop: 670,
      t1: 690,
      t2: 700,
    });
    d.ingest([mkQuote("meta", 678)], [dpOrder]);
    const hits = d.ingest([mkQuote("META", 681)], [dpOrder]);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.levelName).toBe("entry");
  });

  it("emits multiple LevelHits in a single big move", () => {
    const d = makeLevelDetector({ monotonicNowMs: () => 0 });
    const order = mkOrder(); // entry 7090, t1 7105, t2 7120
    d.ingest([mkQuote("ES", 7085)], [order]);
    const hits = d.ingest([mkQuote("ES", 7125)], [order]);
    const names = hits.map((h) => h.levelName).sort();
    expect(names).toEqual(["entry", "t1", "t2"]);
  });

  it("drops stale quotes when staleMs is configured", () => {
    const d = makeLevelDetector({ monotonicNowMs: () => 0, staleMs: 10_000 });
    const order = mkOrder();
    // Seed a prior (stale will apply to every ingest with this nowMs math)
    d.ingest([{ symbol: "ES", last: 7085, bid: 7085, ask: 7085, tsMs: 1_000_000, receivedMs: 1_000_000 }], [order], 1_000_000);
    // Emit at nowMs=1_020_000 with tsMs=1_000_000 → 20s stale → drop.
    const hits = d.ingest(
      [{ symbol: "ES", last: 7092, bid: 7092, ask: 7092, tsMs: 1_000_000, receivedMs: 1_000_000 }],
      [order],
      1_020_000,
    );
    expect(hits).toEqual([]);
    expect(d.staleSkipped()).toBe(1);
  });

  it("does not drop fresh quotes", () => {
    const d = makeLevelDetector({ monotonicNowMs: () => 0, staleMs: 10_000 });
    const order = mkOrder();
    d.ingest(
      [{ symbol: "ES", last: 7085, bid: 7085, ask: 7085, tsMs: 1_000_000, receivedMs: 1_000_000 }],
      [order],
      1_000_000,
    );
    const hits = d.ingest(
      [{ symbol: "ES", last: 7092, bid: 7092, ask: 7092, tsMs: 1_005_000, receivedMs: 1_005_000 }],
      [order],
      1_005_000,
    );
    expect(hits).toHaveLength(1);
    expect(d.staleSkipped()).toBe(0);
  });

  it("preserves the prior price when a stale quote is skipped", () => {
    const d = makeLevelDetector({ monotonicNowMs: () => 0, staleMs: 10_000 });
    const order = mkOrder();
    d.ingest(
      [{ symbol: "ES", last: 7085, bid: 7085, ask: 7085, tsMs: 1_000_000, receivedMs: 1_000_000 }],
      [order],
      1_000_000,
    );
    // Stale quote skipped — does NOT overwrite prev.
    d.ingest(
      [{ symbol: "ES", last: 7080, bid: 7080, ask: 7080, tsMs: 1_000_000, receivedMs: 1_000_000 }],
      [order],
      1_020_000,
    );
    // Fresh quote at 7092 should cross UP from the original 7085, not from 7080.
    const hits = d.ingest(
      [{ symbol: "ES", last: 7092, bid: 7092, ask: 7092, tsMs: 1_025_000, receivedMs: 1_025_000 }],
      [order],
      1_025_000,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.prevPrice).toBe(7085);
    expect(hits[0]?.crossingDirection).toBe("UP");
  });
});

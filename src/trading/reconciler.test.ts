import { describe, expect, it } from "vitest";

import { findCatchupCandidates } from "./reconciler.js";
import type { Alert, EventRow, OrderBlock, PriceQuote } from "./types.js";

type QuoteWithRange = PriceQuote & { dayHigh: number; dayLow: number };

function mkOrder(overrides: Partial<OrderBlock> = {}): OrderBlock {
  return {
    id: "mancini-ES-1",
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
    stopSource: "",
    t1: 7105,
    t1Source: "",
    t2: 7120,
    t2Source: "",
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

function mkQuote(
  symbol: string,
  last: number,
  dayLow: number,
  dayHigh: number,
): QuoteWithRange {
  return {
    symbol,
    last,
    bid: last,
    ask: last,
    tsMs: 0,
    receivedMs: 0,
    dayHigh,
    dayLow,
  };
}

function mkAlertSentEvent(
  id: number,
  orderId: string,
  levelName: Alert["levelName"],
): EventRow {
  const alert: Alert = {
    id: "X",
    orderId,
    sequence: 1,
    source: "mancini",
    horizon: "session",
    ticker: "ES",
    execAs: "/MES",
    accounts: ["tos"],
    direction: "LONG",
    conviction: "HIGH",
    confirmation: "CONFIRMED",
    entry: 7090,
    stop: 7078,
    t1: 7105,
    t2: 7120,
    totalRisk: 120,
    levelName,
    levelPrice: 7090,
    risk: { scope: "advisory-only" },
    expiresAtMs: 0,
  };
  return {
    id,
    tsMs: 0,
    type: "AlertSent",
    payload: { type: "AlertSent", tsMs: 0, alert },
  };
}

describe("findCatchupCandidates", () => {
  it("emits candidates for levels inside today's H/L range", () => {
    const order = mkOrder(); // entry 7090, stop 7078, t1 7105, t2 7120
    // Today's range: 7082 to 7108 — entry and t1 are inside, stop and t2 are not.
    const quotes = [mkQuote("ES", 7105, 7082, 7108)];
    const candidates = findCatchupCandidates({
      orders: [order],
      quotes,
      todaysAlerts: [],
    });
    const names = candidates.map((c) => c.levelName).sort();
    expect(names).toEqual(["entry", "t1"]);
  });

  it("skips levels already alerted today", () => {
    const order = mkOrder();
    const quotes = [mkQuote("ES", 7105, 7082, 7108)];
    const alertSent = mkAlertSentEvent(1, order.id, "entry");
    const candidates = findCatchupCandidates({
      orders: [order],
      quotes,
      todaysAlerts: [alertSent],
    });
    expect(candidates.map((c) => c.levelName)).toEqual(["t1"]);
  });

  it("skips closed / killed / blocked orders", () => {
    const closed = mkOrder({ status: "CLOSED" });
    const killed = mkOrder({ status: "KILLED", id: "b" });
    const blocked = mkOrder({ status: "BLOCKED", id: "c" });
    const quotes = [mkQuote("ES", 7105, 7082, 7108)];
    const candidates = findCatchupCandidates({
      orders: [closed, killed, blocked],
      quotes,
      todaysAlerts: [],
    });
    expect(candidates).toEqual([]);
  });

  it("skips orders with no quote for that ticker", () => {
    const order = mkOrder({ ticker: "UNKNOWN" });
    const quotes = [mkQuote("ES", 7105, 7082, 7108)];
    const candidates = findCatchupCandidates({
      orders: [order],
      quotes,
      todaysAlerts: [],
    });
    expect(candidates).toEqual([]);
  });

  it("matches ticker case-insensitively", () => {
    const order = mkOrder({ ticker: "es" });
    const quotes = [mkQuote("ES", 7105, 7082, 7108)];
    const candidates = findCatchupCandidates({
      orders: [order],
      quotes,
      todaysAlerts: [],
    });
    expect(candidates.length).toBeGreaterThan(0);
  });

  it("ignores zero-valued levels (unset t1/t2)", () => {
    const order = mkOrder({ t1: 0, t2: 0 });
    const quotes = [mkQuote("ES", 7105, 7082, 7108)];
    const candidates = findCatchupCandidates({
      orders: [order],
      quotes,
      todaysAlerts: [],
    });
    expect(candidates.map((c) => c.levelName).sort()).toEqual(["entry"]);
  });

  it("ignores invalid quote ranges (H<L or missing)", () => {
    const order = mkOrder();
    const weirdQuotes = [mkQuote("ES", 7105, 7108, 7082)]; // inverted
    const missingQuotes = [mkQuote("ES", 7105, 0, 0)];
    expect(
      findCatchupCandidates({
        orders: [order],
        quotes: weirdQuotes,
        todaysAlerts: [],
      }),
    ).toEqual([]);
    expect(
      findCatchupCandidates({
        orders: [order],
        quotes: missingQuotes,
        todaysAlerts: [],
      }),
    ).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import { defaultRiskThresholds, resolveAccounts } from "./config.js";
import { checkRisk } from "./risk.js";
import type { OrderBlock, RiskState } from "./types.js";

function mkOrder(overrides: Partial<OrderBlock> = {}): OrderBlock {
  return {
    id: "test",
    sequence: 1,
    source: "scanner",
    accounts: ["tradier"],
    ticker: "AAPL",
    execAs: "AAPL",
    direction: "LONG",
    setup: "",
    why: "",
    entry: 170,
    entryOrderType: "LMT",
    stop: 167,
    stopSource: "",
    t1: 175,
    t1Source: "",
    t2: 180,
    t2Source: "",
    runner: "",
    riskPerShare: 3,
    quantity: 10,
    totalRisk: 30,
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

function mkState(overrides: Partial<RiskState> = {}): RiskState {
  return {
    tradierBalance: 3000,
    tradierPositions: [],
    tradierDailyPnl: 0,
    tradierPdtCountLast5Days: 0,
    advisoryHoldings: [],
    ...overrides,
  };
}

const THRESHOLDS = defaultRiskThresholds();
const ACCOUNTS = resolveAccounts();

describe("checkRisk", () => {
  it("approves a well-sized Tradier trade", () => {
    // $30 risk on $3000 balance = 1.0% — exactly at cap. Order is smaller
    // than cap so should pass.
    const decision = checkRisk({
      order: mkOrder({ totalRisk: 25 }),
      state: mkState(),
      thresholds: THRESHOLDS,
      accounts: ACCOUNTS,
    });
    expect(decision.block).toBeUndefined();
    expect(decision.scope).toBe("tradier-strict");
  });

  it("blocks when per-trade risk exceeds cap", () => {
    const decision = checkRisk({
      order: mkOrder({ totalRisk: 50 }), // 1.67% of $3000
      state: mkState(),
      thresholds: THRESHOLDS,
      accounts: ACCOUNTS,
    });
    expect(decision.block).toMatch(/per-trade risk/);
  });

  it("blocks when at concurrent-position cap", () => {
    const decision = checkRisk({
      order: mkOrder(),
      state: mkState({
        tradierPositions: [
          { symbol: "SPY", qty: 1, avgPrice: 500 },
          { symbol: "QQQ", qty: 1, avgPrice: 400 },
          { symbol: "IWM", qty: 1, avgPrice: 280 },
          { symbol: "NVDA", qty: 1, avgPrice: 200 },
        ],
      }),
      thresholds: THRESHOLDS,
      accounts: ACCOUNTS,
    });
    expect(decision.block).toMatch(/concurrent-position cap/);
  });

  it("blocks when projected exposure exceeds 60%", () => {
    // $3000 × 60% = $1800. Large quantity pushes notional over.
    const decision = checkRisk({
      order: mkOrder({ entry: 100, quantity: 20, totalRisk: 20 }), // $2000 notional
      state: mkState(),
      thresholds: THRESHOLDS,
      accounts: ACCOUNTS,
    });
    expect(decision.block).toMatch(/projected exposure/);
  });

  it("suggests a smaller quantity when per-trade risk is over cap", () => {
    // $60 risk on $3K balance = 2%; cap is 1% = $30. riskPerShare = $6,
    // so suggested qty = floor(30/6) = 5.
    const decision = checkRisk({
      order: mkOrder({ riskPerShare: 6, quantity: 10, totalRisk: 60 }),
      state: mkState(),
      thresholds: THRESHOLDS,
      accounts: ACCOUNTS,
    });
    expect(decision.block).toMatch(/per-trade risk/);
    expect(decision.suggestedQuantity).toBe(5);
  });

  it("suggests a smaller quantity when exposure cap is hit", () => {
    // $3000 × 60% = $1800 budget; entry $100, multiplier 1 → 18 shares fit.
    const decision = checkRisk({
      order: mkOrder({
        entry: 100,
        quantity: 20, // $2000 notional — over cap
        totalRisk: 10, // below per-trade cap so we reach exposure check
        riskPerShare: 0.5,
      }),
      state: mkState(),
      thresholds: THRESHOLDS,
      accounts: ACCOUNTS,
    });
    expect(decision.block).toMatch(/projected exposure/);
    expect(decision.suggestedQuantity).toBe(18);
  });

  it("does not suggest a quantity for non-sizing blocks (long-only, blackout)", () => {
    const d1 = checkRisk({
      order: mkOrder({ accounts: ["ira"], direction: "SHORT" }),
      state: mkState(),
      thresholds: THRESHOLDS,
      accounts: ACCOUNTS,
    });
    expect(d1.suggestedQuantity).toBeUndefined();

    const d2 = checkRisk({
      order: mkOrder({ accounts: ["tradier"] }),
      state: mkState({
        activeBlackouts: [{ scope: "all", name: "FOMC", reason: "2pm" }],
      }),
      thresholds: THRESHOLDS,
      accounts: ACCOUNTS,
    });
    expect(d2.suggestedQuantity).toBeUndefined();
  });

  it("suggests 0 when even one share doesn't fit exposure budget", () => {
    // Exposure already at $1800 from existing position; new /ES @ 7000 × $50 = $350K.
    const decision = checkRisk({
      order: mkOrder({
        ticker: "ES",
        execAs: "/ES",
        entry: 7000,
        quantity: 1,
        totalRisk: 25,
        riskPerShare: 25,
      }),
      state: mkState({
        tradierPositions: [{ symbol: "SPY", qty: 4, avgPrice: 450 }], // $1800 notional
      }),
      thresholds: THRESHOLDS,
      accounts: ACCOUNTS,
    });
    expect(decision.block).toMatch(/projected exposure/);
    expect(decision.suggestedQuantity).toBe(0);
  });

  it("blocks when daily loss limit is breached", () => {
    const decision = checkRisk({
      order: mkOrder(),
      state: mkState({ tradierDailyPnl: -400 }),
      thresholds: THRESHOLDS,
      accounts: ACCOUNTS,
    });
    expect(decision.block).toMatch(/daily loss/);
  });

  it("warns (not blocks) when at PDT limit", () => {
    const decision = checkRisk({
      order: mkOrder(),
      state: mkState({ tradierPdtCountLast5Days: 3 }),
      thresholds: THRESHOLDS,
      accounts: ACCOUNTS,
    });
    expect(decision.block).toBeUndefined();
    expect(decision.warn).toMatch(/PDT/);
  });

  it("classifies scope=advisory-only for TOS/IRA-only orders", () => {
    const decision = checkRisk({
      order: mkOrder({ accounts: ["tos", "ira"] }),
      state: mkState(),
      thresholds: THRESHOLDS,
      accounts: ACCOUNTS,
    });
    expect(decision.scope).toBe("advisory-only");
    expect(decision.block).toBeUndefined();
  });

  it("classifies scope=mixed when both Tradier and advisory are targeted", () => {
    const decision = checkRisk({
      order: mkOrder({ accounts: ["tos", "ira", "tradier"] }),
      state: mkState(),
      thresholds: THRESHOLDS,
      accounts: ACCOUNTS,
    });
    expect(decision.scope).toBe("mixed");
  });

  it("warns on cross-account concentration from advisory holdings", () => {
    const decision = checkRisk({
      order: mkOrder({ accounts: ["tos", "ira"], ticker: "META" }),
      state: mkState({
        advisoryHoldings: [{ ticker: "META", accounts: ["ira"] }],
      }),
      thresholds: THRESHOLDS,
      accounts: ACCOUNTS,
    });
    expect(decision.warn).toMatch(/cross-account concentration/i);
  });

  it("never blocks a pure TOS/IRA order", () => {
    // Even with tradierDailyPnl below limit, advisory-only orders are not
    // blocked because the governor has no authority over manual accounts.
    const decision = checkRisk({
      order: mkOrder({ accounts: ["tos"], totalRisk: 5000 }),
      state: mkState({ tradierDailyPnl: -10_000 }),
      thresholds: THRESHOLDS,
      accounts: ACCOUNTS,
    });
    expect(decision.block).toBeUndefined();
    expect(decision.scope).toBe("advisory-only");
  });

  it("blocks SHORT orders routed to IRA (long-only)", () => {
    const decision = checkRisk({
      order: mkOrder({ accounts: ["ira"], direction: "SHORT" }),
      state: mkState(),
      thresholds: THRESHOLDS,
      accounts: ACCOUNTS,
    });
    expect(decision.block).toMatch(/ira is long-only/i);
  });

  it("blocks SHORT orders routed to Tradier+IRA mixed", () => {
    // Even when Tradier could take the short, mixed routing to IRA is
    // invalid at broker level — the order must be restructured.
    const decision = checkRisk({
      order: mkOrder({ accounts: ["tradier", "ira"], direction: "SHORT" }),
      state: mkState(),
      thresholds: THRESHOLDS,
      accounts: ACCOUNTS,
    });
    expect(decision.block).toMatch(/ira is long-only/i);
  });

  it("allows LONG orders to IRA", () => {
    const decision = checkRisk({
      order: mkOrder({ accounts: ["ira"], direction: "LONG" }),
      state: mkState(),
      thresholds: THRESHOLDS,
      accounts: ACCOUNTS,
    });
    expect(decision.block).toBeUndefined();
    expect(decision.scope).toBe("advisory-only");
  });

  it("allows SHORT orders to TOS (margin account)", () => {
    const decision = checkRisk({
      order: mkOrder({ accounts: ["tos"], direction: "SHORT" }),
      state: mkState(),
      thresholds: THRESHOLDS,
      accounts: ACCOUNTS,
    });
    expect(decision.block).toBeUndefined();
  });

  it("applies /MES multiplier ($5/pt) to exposure calc", () => {
    // Without multiplier, 1 /MES @ 7090 = $7090 notional (fits 60% of $3K, falsely).
    // With multiplier, 1 × 7090 × $5 = $35,450 — way over 60% of $3K ($1800).
    const decision = checkRisk({
      order: mkOrder({
        ticker: "ES",
        execAs: "/MES",
        entry: 7090,
        quantity: 1,
        totalRisk: 25, // below per-trade cap so we reach exposure check
      }),
      state: mkState(),
      thresholds: THRESHOLDS,
      accounts: ACCOUNTS,
    });
    expect(decision.block).toMatch(/projected exposure/);
    expect(decision.block).toMatch(/\$35,?450/);
  });

  it("sums existing /MES positions with multiplier into current exposure", () => {
    // Already short 1 /MES @ 7080 — that's $35,400 of held notional.
    const decision = checkRisk({
      order: mkOrder({ ticker: "AAPL", execAs: "AAPL", entry: 170, quantity: 1, totalRisk: 3 }),
      state: mkState({
        tradierPositions: [{ symbol: "/MES", qty: 1, avgPrice: 7080 }],
      }),
      thresholds: THRESHOLDS,
      accounts: ACCOUNTS,
    });
    expect(decision.block).toMatch(/projected exposure/);
  });

  it("blocks Tradier orders during a global blackout (FOMC)", () => {
    const decision = checkRisk({
      order: mkOrder({ accounts: ["tradier"] }),
      state: mkState({
        activeBlackouts: [
          { scope: "all", name: "FOMC", reason: "rate decision 2:00pm ET" },
        ],
      }),
      thresholds: THRESHOLDS,
      accounts: ACCOUNTS,
    });
    expect(decision.block).toMatch(/event blackout: FOMC/);
  });

  it("blocks Tradier orders for ticker-scoped earnings blackout", () => {
    const decision = checkRisk({
      order: mkOrder({ accounts: ["tradier"], ticker: "NVDA" }),
      state: mkState({
        activeBlackouts: [
          { scope: { ticker: "NVDA" }, name: "NVDA earnings", reason: "AMC report" },
        ],
      }),
      thresholds: THRESHOLDS,
      accounts: ACCOUNTS,
    });
    expect(decision.block).toMatch(/NVDA earnings/);
  });

  it("does not block unrelated tickers during a per-ticker blackout", () => {
    const decision = checkRisk({
      order: mkOrder({ accounts: ["tradier"], ticker: "AMZN" }),
      state: mkState({
        activeBlackouts: [
          { scope: { ticker: "NVDA" }, name: "NVDA earnings", reason: "AMC" },
        ],
      }),
      thresholds: THRESHOLDS,
      accounts: ACCOUNTS,
    });
    expect(decision.block).toBeUndefined();
  });

  it("warns (not blocks) advisory-only orders during a blackout", () => {
    const decision = checkRisk({
      order: mkOrder({ accounts: ["tos", "ira"] }),
      state: mkState({
        activeBlackouts: [
          { scope: "all", name: "CPI", reason: "08:30 ET release" },
        ],
      }),
      thresholds: THRESHOLDS,
      accounts: ACCOUNTS,
    });
    expect(decision.block).toBeUndefined();
    expect(decision.warn).toMatch(/event blackout: CPI/);
  });

  it("blocks mixed-account orders during a blackout", () => {
    // Even the Tradier leg is at risk — don't let a mixed order slip through.
    const decision = checkRisk({
      order: mkOrder({ accounts: ["tos", "tradier"] }),
      state: mkState({
        activeBlackouts: [{ scope: "all", name: "FOMC", reason: "2:00pm" }],
      }),
      thresholds: THRESHOLDS,
      accounts: ACCOUNTS,
    });
    expect(decision.block).toMatch(/FOMC/);
  });

  it("treats unknown tickers as 1x (equity default)", () => {
    const decision = checkRisk({
      order: mkOrder({ entry: 100, quantity: 10, totalRisk: 5 }), // $1000 notional
      state: mkState(),
      thresholds: THRESHOLDS,
      accounts: ACCOUNTS,
    });
    // $1000 is under $1800 cap; should pass.
    expect(decision.block).toBeUndefined();
  });
});

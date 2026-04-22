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
});

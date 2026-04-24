/**
 * Shadow-mode scenario tests.
 *
 * These are end-to-end smoke scenarios — brief in, ticks in, events out.
 * The assertions validate the boundary invariants:
 *
 *   1. A quote that crosses an ACTIVE entry level emits one alert.
 *   2. Risk violations produce a blocked event, never an alert.
 *   3. Dedup suppresses storm-fire on chop through a level.
 *   4. IRA SHORT orders block (the long-only rule from iteration 1).
 *   5. A chop sequence that whipsaws doesn't produce runaway alerts.
 *
 * Add scenarios here as we discover edge cases — the harness is cheap so
 * there's no excuse to leave a bug unreproduced.
 */

import { describe, expect, it } from "vitest";

import { parseOrderBlocks } from "./plan.js";
import { diffTrace, replayScenario, summarizeTrace } from "./shadow.js";
import type { ShadowScenario } from "./shadow.js";

// Advisory-scope brief: TOS routing means risk governor won't block on
// exposure, so scenarios focused on the *detector + pipeline* path are not
// derailed by the $3K Tradier exposure cap. Use a Tradier-routed variant
// when the scenario specifically exercises risk blocking.
const SIMPLE_BRIEF = `
## Orders

ORDER 1 | HIGH | ACTIVE
  source:       mancini
  accounts:     tos
  ticker:       ES
  exec_as:      /MES
  direction:    LONG
  setup:        Failed Breakdown
  why:          reclaim
  entry:        7090 LMT
  stop:         7078 — flush-4
  t1:           7105 — next R
  t2:           7120 — next R
  runner:       10% trail BE after T1
  risk:         $12 | 2 /MES | $24
  confirmation: CONFIRMED
  confluence:   none
  caveat:       none
  kills:        none
  activation:   immediate
  verify:       none
`;

const TRADIER_STRICT_BRIEF = SIMPLE_BRIEF.replace(
  "accounts:     tos",
  "accounts:     tradier",
);

const IRA_SHORT_BRIEF = `
## Orders

ORDER 1 | MEDIUM | ACTIVE
  source:       dp
  accounts:     ira
  ticker:       TSLA
  exec_as:      TSLA
  direction:    SHORT
  setup:        rejection at range high
  why:          short from R
  entry:        260 LMT
  stop:         265 — stated
  t1:           250 — stated
  t2:           245 — stated
  runner:       10% trail BE after T1
  risk:         $5 | 10 TSLA | $50
  confirmation: CONFIRMED
  confluence:   none
  caveat:       none
  kills:        none
  activation:   immediate
  verify:       none
`;

const T0 = 1_700_000_000_000;

describe("shadow mode replay", () => {
  it("happy path: one tick crossing entry produces one alert", () => {
    const scenario: ShadowScenario = {
      name: "entry-cross",
      brief: SIMPLE_BRIEF,
      seedPrices: { ES: 7085 },
      ticks: [{ symbol: "ES", last: 7092, tsMs: T0 }],
    };

    const result = replayScenario(scenario);
    const diff = diffTrace(result, [
      { kind: "alert", sequence: 1, levelName: "entry", crossingDirection: "UP" },
    ]);
    expect(diff.problems).toEqual([]);
    expect(diff.ok).toBe(true);
  });

  it("blocks IRA SHORT orders via the long-only rule", () => {
    const scenario: ShadowScenario = {
      name: "ira-short",
      brief: IRA_SHORT_BRIEF,
      seedPrices: { TSLA: 262 },
      ticks: [{ symbol: "TSLA", last: 259, tsMs: T0 }],
    };

    const result = replayScenario(scenario);
    const diff = diffTrace(result, [
      {
        kind: "blocked",
        sequence: 1,
        levelName: "entry",
        crossingDirection: "DOWN",
        blockMatches: /ira is long-only/i,
      },
    ]);
    expect(diff.problems).toEqual([]);
  });

  it("blocks oversized Tradier orders (per-trade risk cap)", () => {
    // $60 total risk on a $3000 Tradier balance = 2% — over the 1% cap.
    // Note: exposure cap also fails for /MES at this quantity, but per-trade
    // check runs first and short-circuits.
    const oversized = TRADIER_STRICT_BRIEF.replace("$12 | 2 /MES | $24", "$30 | 2 /MES | $60");
    const scenario: ShadowScenario = {
      name: "oversize-cap",
      brief: oversized,
      seedPrices: { ES: 7085 },
      ticks: [{ symbol: "ES", last: 7092, tsMs: T0 }],
    };

    const result = replayScenario(scenario);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.kind).toBe("blocked");
    expect(result.events[0]?.blockReason).toMatch(/per-trade risk/);
  });

  it("dedup: chop through the level within TTL yields only one alert", () => {
    const scenario: ShadowScenario = {
      name: "chop",
      brief: SIMPLE_BRIEF,
      seedPrices: { ES: 7085 },
      ticks: [
        { symbol: "ES", last: 7092, tsMs: T0 }, // UP cross of 7090
        { symbol: "ES", last: 7088, tsMs: T0 + 1_000 }, // DOWN cross — different direction, separate dedup key, new event
        { symbol: "ES", last: 7093, tsMs: T0 + 2_000 }, // UP again — within 60s TTL, suppressed
      ],
    };

    const result = replayScenario(scenario);
    // Two events: UP at t0, DOWN at t0+1. Third UP is suppressed by dedup.
    const kinds = result.events.map((e) => `${e.kind}/${e.crossingDirection}`);
    expect(kinds).toEqual(["alert/UP", "alert/DOWN"]);
  });

  it("global FOMC blackout blocks every Tradier order in the plan", () => {
    const scenario: ShadowScenario = {
      name: "fomc-blackout",
      brief: TRADIER_STRICT_BRIEF.replace(
        "risk:         $12 | 2 /MES | $24",
        "risk:         $5 | 1 /MES | $10", // sized to fit exposure post-multiplier? still blocked for event
      ),
      state: {
        activeBlackouts: [
          { scope: "all", name: "FOMC", reason: "2pm ET rate decision" },
        ],
      },
      seedPrices: { ES: 7085 },
      ticks: [{ symbol: "ES", last: 7092, tsMs: T0 }],
    };
    const result = replayScenario(scenario);
    expect(result.events[0]?.kind).toBe("blocked");
    expect(result.events[0]?.blockReason).toMatch(/FOMC/);
  });

  it("daily loss limit blocks future entries", () => {
    const scenario: ShadowScenario = {
      name: "daily-loss-halt",
      // Must be Tradier-routed — daily-loss halt is a Tradier-strict rule.
      brief: TRADIER_STRICT_BRIEF.replace(
        "risk:         $12 | 2 /MES | $24",
        "risk:         $5 | 2 /MES | $10",
      ),
      state: { tradierDailyPnl: -400 }, // past the -$300 default
      seedPrices: { ES: 7085 },
      ticks: [{ symbol: "ES", last: 7092, tsMs: T0 }],
    };

    const result = replayScenario(scenario);
    expect(result.events[0]?.kind).toBe("blocked");
    expect(result.events[0]?.blockReason).toMatch(/daily loss/i);
  });

  it("empty brief produces zero events", () => {
    const scenario: ShadowScenario = {
      name: "empty",
      brief: "## Orders\n\n(no setups today)\n",
      seedPrices: { ES: 7085 },
      ticks: [{ symbol: "ES", last: 7092, tsMs: T0 }],
    };
    const result = replayScenario(scenario);
    expect(result.orderCount).toBe(0);
    expect(result.events).toEqual([]);
  });

  it("boot reconciler: emits catch-up alert when level crossed while sidecar was down", () => {
    const result = replayScenario({
      name: "catch-up",
      brief: SIMPLE_BRIEF,
      boot: {
        bootQuotes: [
          { symbol: "ES", last: 7095, tsMs: T0, dayHigh: 7100, dayLow: 7080 },
        ],
      },
      ticks: [],
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.kind).toBe("alert");
    expect(result.events[0]?.alert?.catchup).toBe(true);
    expect(result.events[0]?.alert?.levelName).toBe("entry");
  });

  it("boot reconciler: suppresses catch-up when prior alert exists in the log", () => {
    const { orders } = parseOrderBlocks(SIMPLE_BRIEF);
    const orderId = orders[0]?.id ?? "";
    const result = replayScenario({
      name: "catch-up-suppressed",
      brief: SIMPLE_BRIEF,
      boot: {
        // Tight range around entry so only the entry level is in [low, high].
        bootQuotes: [
          { symbol: "ES", last: 7095, tsMs: T0, dayHigh: 7095, dayLow: 7086 },
        ],
        priorAlerts: [{ orderId, levelName: "entry" }],
      },
      ticks: [],
    });
    // Already alerted — reconciler must not re-fire.
    expect(result.events).toEqual([]);
  });

  it("boot reconciler: no catch-up when no level is inside day range", () => {
    const result = replayScenario({
      name: "catch-up-out-of-range",
      brief: SIMPLE_BRIEF,
      boot: {
        // Range [7040, 7060]: entry 7090, stop 7078, t1 7105, t2 7120 all outside.
        bootQuotes: [
          { symbol: "ES", last: 7045, tsMs: T0, dayHigh: 7060, dayLow: 7040 },
        ],
      },
      ticks: [],
    });
    expect(result.events).toEqual([]);
  });

  it("boot seed: live ticks after boot use boot last-price as prev", () => {
    const result = replayScenario({
      name: "boot-seed",
      brief: SIMPLE_BRIEF,
      boot: {
        bootQuotes: [
          { symbol: "ES", last: 7100, tsMs: T0, dayHigh: 7101, dayLow: 7099 },
        ],
      },
      ticks: [{ symbol: "ES", last: 7106, tsMs: T0 + 1000 }],
    });
    // No catch-up (7090 not inside [7099, 7101]). But the seed at 7100 means
    // the 7106 tick should cross T1 cleanly — exactly one hit.
    const liveAlerts = result.events.filter((e) => e.alert?.catchup !== true);
    expect(liveAlerts).toHaveLength(1);
    expect(liveAlerts[0]?.levelName).toBe("t1");
  });

  it("summarizeTrace produces a readable debug string", () => {
    const result = replayScenario({
      name: "summary-smoke",
      brief: SIMPLE_BRIEF,
      seedPrices: { ES: 7085 },
      ticks: [{ symbol: "ES", last: 7092, tsMs: T0 }],
    });
    const s = summarizeTrace(result);
    expect(s).toMatch(/shadow\/summary-smoke/);
    expect(s).toMatch(/ALERT/);
  });
});

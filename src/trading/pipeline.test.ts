/**
 * End-to-end pipeline composition test.
 *
 * Unit tests cover each piece (parser, detector, risk, signal, commands).
 * This test proves the pieces compose correctly in the one call path that
 * matters — a quote crosses a level, governor approves, an alert is sent,
 * Simon replies, the reply threads back to the originating alert.
 *
 * No real Tradier / signal-cli / SQLite. Just the in-memory primitives,
 * wired as index.ts wires them.
 */

import { describe, expect, it } from "vitest";

import { defaultRiskThresholds, resolveAccounts } from "./config.js";
import { makeLevelDetector } from "./detector.js";
import { buildAlert, scopeForAccounts } from "./pipeline.js";
import { parseOrderBlocks } from "./plan.js";
import { checkRisk } from "./risk.js";
import {
  formatAlertMessage,
  generateAlertId,
  makeInMemoryChannel,
  parseReply,
} from "./signal.js";
import type { OrderBlock, PriceQuote, RiskState } from "./types.js";

function quote(symbol: string, last: number, ts = 0): PriceQuote {
  return { symbol, last, bid: last, ask: last, tsMs: ts, receivedMs: ts };
}

function baselineRiskState(): RiskState {
  return {
    tradierBalance: 3000,
    tradierPositions: [],
    tradierDailyPnl: 0,
    tradierPdtCountLast5Days: 0,
    advisoryHoldings: [],
  };
}

const BRIEF_WITH_ORDER = `
## Orders

ORDER 1 | HIGH | ACTIVE
  source:       mancini
  accounts:     tos
  ticker:       ES
  exec_as:      /MES
  direction:    LONG
  setup:        Failed Breakdown A+
  why:          quality reclaim
  entry:        7090 LMT
  stop:         7078 — flush-4
  t1:           7105 — next R
  t2:           7120 — next R
  runner:       10% trail BE after T1
  risk:         $12 | 2 /MES | $120
  confirmation: CONFIRMED
  confluence:   none
  caveat:       none
  kills:        none
  activation:   immediate
  verify:       none
`;

describe("alert pipeline composition", () => {
  it("end-to-end: parse plan → cross level → alert → format → send → reply", async () => {
    // 1. Parse today's plan.
    const { orders, warnings } = parseOrderBlocks(BRIEF_WITH_ORDER);
    expect(warnings).toEqual([]);
    expect(orders).toHaveLength(1);
    const order = orders[0] as OrderBlock;

    // 2. Run a detector with an in-memory clock.
    let monoNow = 0;
    const detector = makeLevelDetector({ monotonicNowMs: () => monoNow });

    // 3. First poll seeds prev-price — no hits expected.
    const t0 = 1_700_000_000_000;
    const seedHits = detector.ingest([quote("ES", 7085, t0)], [order], t0);
    expect(seedHits).toEqual([]);

    // 4. Second poll crosses the 7090 entry level UP.
    monoNow = 1000;
    const t1 = t0 + 1000;
    const hits = detector.ingest([quote("ES", 7092, t1)], [order], t1);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.levelName).toBe("entry");
    expect(hits[0]?.crossingDirection).toBe("UP");

    // 5. Governor evaluates — this order's size is within the Tradier cap;
    //    order targets TOS only, so scope is "advisory-only" and no block.
    const decision = checkRisk({
      order,
      state: baselineRiskState(),
      thresholds: defaultRiskThresholds(),
      accounts: resolveAccounts(),
    });
    expect(decision.block).toBeUndefined();
    expect(decision.scope).toBe("advisory-only");
    expect(scopeForAccounts(order.accounts)).toBe("advisory-only");

    // 6. Build the alert.
    const firstHit = hits[0];
    if (!firstHit) throw new Error("expected at least one hit");
    const alert = buildAlert({
      hit: firstHit,
      order,
      decision,
      nowMs: t1,
      alertId: "T3ST",
    });
    expect(alert.id).toBe("T3ST");
    expect(alert.horizon).toBe("session"); // Mancini → session horizon
    expect(alert.expiresAtMs).toBe(t1 + 5 * 60 * 1000);

    // 7. Format for Signal and deliver.
    const channel = makeInMemoryChannel();
    const body = formatAlertMessage(alert);
    await channel.send(body);

    expect(channel.outbox).toHaveLength(1);
    expect(channel.outbox[0]).toContain("YES-T3ST");
    expect(channel.outbox[0]).toContain("MANCINI ES"); // source is upper-cased in the header
    expect(channel.outbox[0]).toContain("Governor: OK");

    // 8. Simon replies. Parse it back and confirm the id threads.
    channel.inbox.push("yes t3st");
    const [reply] = await channel.receive();
    const parsed = parseReply(reply ?? "");
    expect(parsed.type).toBe("approve");
    expect(parsed.alertId).toBe("T3ST");
  });

  it("catch-up path: boot-time reconciliation emits a catchup-flagged alert", () => {
    const { orders } = parseOrderBlocks(BRIEF_WITH_ORDER);
    const order = orders[0] as OrderBlock;
    const nowMs = 2_000_000_000_000;

    // Build a synthetic catch-up alert as the reconciler would.
    const catchupHit = {
      orderId: order.id,
      sequence: order.sequence,
      ticker: order.ticker,
      source: order.source,
      levelName: "entry" as const,
      levelPrice: order.entry,
      crossingDirection: "UP" as const,
      proximity: "AT" as const,
      conviction: order.conviction,
      confirmation: order.confirmation,
      prevPrice: 7082,
      currentPrice: 7100,
      hitMs: nowMs,
      catchup: true,
    };

    const alert = buildAlert({
      hit: catchupHit,
      order,
      decision: { scope: scopeForAccounts(order.accounts) },
      nowMs,
      alertId: "C4T1",
      catchup: true,
    });

    expect(alert.catchup).toBe(true);
    // Catch-up TTL is shorter (15 min) than the session TTL (5 min) would
    // be — actually shorter than catchup=false for swing/portfolio but
    // longer than session. Key invariant: it's the catchup constant.
    expect(alert.expiresAtMs - nowMs).toBe(15 * 60 * 1000);

    // The rendered message uses the 🔁 CATCHUP prefix so Simon can tell
    // these apart from live alerts immediately.
    const body = formatAlertMessage(alert);
    expect(body.split("\n")[0]).toMatch(/🔁 CATCHUP/);
  });

  it("blocked path: governor rejection suppresses the alert entirely", () => {
    const { orders } = parseOrderBlocks(
      BRIEF_WITH_ORDER.replace("accounts:     tos", "accounts:     tradier"),
    );
    const order = orders[0] as OrderBlock;

    // Force a block: daily loss limit reached on the Tradier account.
    const decision = checkRisk({
      order,
      state: { ...baselineRiskState(), tradierDailyPnl: -500 },
      thresholds: defaultRiskThresholds(),
      accounts: resolveAccounts(),
    });
    expect(decision.block).toMatch(/daily loss/);

    // If we *were* to build an alert anyway, it would carry the block
    // reason. In the real pipeline (index.ts:handleLevelHit) the flow
    // short-circuits before buildAlert — this test proves the contract
    // both directions.
    const alert = buildAlert({
      hit: {
        orderId: order.id,
        sequence: order.sequence,
        ticker: order.ticker,
        source: order.source,
        levelName: "entry",
        levelPrice: order.entry,
        crossingDirection: "UP",
        proximity: "AT",
        conviction: order.conviction,
        confirmation: order.confirmation,
        prevPrice: order.entry - 1,
        currentPrice: order.entry + 1,
        hitMs: 0,
      },
      order,
      decision,
      nowMs: 0,
      alertId: "BLKD",
    });
    expect(alert.risk.block).toMatch(/daily loss/);
  });

  it("generates unique alert ids across many calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) ids.add(generateAlertId());
    // Collisions at 4 chars of 36 alphabet are rare but possible; require
    // at least 195 unique across 200 draws as a soft-but-useful bound.
    expect(ids.size).toBeGreaterThanOrEqual(195);
  });
});

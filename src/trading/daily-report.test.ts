import { describe, expect, it } from "vitest";

import { buildDailyReport, renderDailyReport } from "./daily-report.js";
import type { Alert, EventRow, TradingEvent } from "./types.js";

const DAY_START = Date.UTC(2026, 3, 23, 13, 30); // 9:30am ET
const DAY_END = DAY_START + 24 * 60 * 60 * 1000;

function alertPayload(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "ALRT",
    orderId: "mancini-ES-deadbeef",
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
    levelName: "entry",
    levelPrice: 7090,
    risk: { scope: "advisory-only" },
    expiresAtMs: 0,
    ...overrides,
  };
}

function row(id: number, tsMs: number, payload: TradingEvent): EventRow {
  return { id, tsMs, type: payload.type, payload };
}

describe("buildDailyReport", () => {
  it("counts alerts by source and conviction", () => {
    const rows: EventRow[] = [
      row(1, DAY_START + 1000, {
        type: "AlertSent",
        tsMs: DAY_START + 1000,
        alert: alertPayload({ source: "mancini", conviction: "HIGH" }),
      }),
      row(2, DAY_START + 2000, {
        type: "AlertSent",
        tsMs: DAY_START + 2000,
        alert: alertPayload({ source: "mancini", conviction: "HIGH" }),
      }),
      row(3, DAY_START + 3000, {
        type: "AlertSent",
        tsMs: DAY_START + 3000,
        alert: alertPayload({ source: "dp", conviction: "MEDIUM" }),
      }),
    ];
    const report = buildDailyReport(rows, { startMs: DAY_START, endMs: DAY_END });
    expect(report.alerts).toEqual([
      {
        source: "mancini",
        conviction: "HIGH",
        count: 2,
        latestTsMs: DAY_START + 2000,
      },
      {
        source: "dp",
        conviction: "MEDIUM",
        count: 1,
        latestTsMs: DAY_START + 3000,
      },
    ]);
  });

  it("counts catch-up alerts separately from live", () => {
    const rows: EventRow[] = [
      row(1, DAY_START + 1000, {
        type: "AlertSent",
        tsMs: DAY_START + 1000,
        alert: alertPayload({ catchup: true }),
      }),
      row(2, DAY_START + 2000, {
        type: "AlertSent",
        tsMs: DAY_START + 2000,
        alert: alertPayload(),
      }),
    ];
    const report = buildDailyReport(rows, { startMs: DAY_START, endMs: DAY_END });
    expect(report.catchups).toBe(1);
    // Both alerts still roll up as usual.
    expect(report.alerts[0]?.count).toBe(2);
  });

  it("rolls up governor blocks by reason", () => {
    const rows: EventRow[] = [
      row(1, DAY_START + 100, {
        type: "RiskDecision",
        tsMs: DAY_START + 100,
        orderId: "dp-NVDA-abc",
        decision: {
          scope: "tradier-strict",
          block: "per-trade risk $60 exceeds 1% cap",
        },
      }),
      row(2, DAY_START + 200, {
        type: "RiskDecision",
        tsMs: DAY_START + 200,
        orderId: "dp-META-def",
        decision: {
          scope: "tradier-strict",
          block: "per-trade risk $60 exceeds 1% cap",
        },
      }),
      row(3, DAY_START + 300, {
        type: "RiskDecision",
        tsMs: DAY_START + 300,
        orderId: "dp-TSLA-ghi",
        decision: {
          scope: "tradier-strict",
          block: "daily loss limit reached",
        },
      }),
    ];
    const report = buildDailyReport(rows, { startMs: DAY_START, endMs: DAY_END });
    expect(report.blocks).toEqual([
      {
        reason: "per-trade risk $60 exceeds 1% cap",
        count: 2,
        sampleTicker: "NVDA",
      },
      {
        reason: "daily loss limit reached",
        count: 1,
        sampleTicker: "TSLA",
      },
    ]);
  });

  it("records halt edges in chronological order", () => {
    const rows: EventRow[] = [
      row(1, DAY_START + 200, {
        type: "HaltEdge",
        tsMs: DAY_START + 200,
        haltType: "DAILY_LOSS",
        direction: "cleared",
      }),
      row(2, DAY_START + 100, {
        type: "HaltEdge",
        tsMs: DAY_START + 100,
        haltType: "DAILY_LOSS",
        direction: "entered",
        reason: "PnL -$320 past limit",
      }),
    ];
    const report = buildDailyReport(rows, { startMs: DAY_START, endMs: DAY_END });
    expect(report.haltEdges.map((h) => h.direction)).toEqual(["entered", "cleared"]);
  });

  it("counts poll failures and plan reloads", () => {
    const rows: EventRow[] = [
      row(1, DAY_START + 10, {
        type: "PollFailed",
        tsMs: DAY_START + 10,
        error: "timeout",
        consecutiveFailures: 1,
      }),
      row(2, DAY_START + 20, {
        type: "PollFailed",
        tsMs: DAY_START + 20,
        error: "timeout",
        consecutiveFailures: 2,
      }),
      row(3, DAY_START + 30, {
        type: "PlanLoaded",
        tsMs: DAY_START + 30,
        orderCount: 3,
        path: "/tmp/brief.md",
      }),
    ];
    const report = buildDailyReport(rows, { startMs: DAY_START, endMs: DAY_END });
    expect(report.pollFailures).toBe(2);
    expect(report.planReloads).toBe(1);
  });

  it("respects the range filter", () => {
    const rows: EventRow[] = [
      row(1, DAY_START - 1000, {
        type: "AlertSent",
        tsMs: DAY_START - 1000,
        alert: alertPayload(),
      }),
      row(2, DAY_START + 1000, {
        type: "AlertSent",
        tsMs: DAY_START + 1000,
        alert: alertPayload(),
      }),
    ];
    const report = buildDailyReport(rows, { startMs: DAY_START, endMs: DAY_END });
    expect(report.alerts[0]?.count).toBe(1);
  });
});

describe("renderDailyReport", () => {
  it("renders a quiet-day message when there are no alerts", () => {
    const report = buildDailyReport([], { startMs: DAY_START, endMs: DAY_END });
    expect(renderDailyReport(report)).toMatch(/No alerts fired/);
  });

  it("renders alert and block tables with summary bullets", () => {
    const rows: EventRow[] = [
      row(1, DAY_START + 1000, {
        type: "AlertSent",
        tsMs: DAY_START + 1000,
        alert: alertPayload({ source: "mancini", conviction: "HIGH" }),
      }),
      row(2, DAY_START + 2000, {
        type: "RiskDecision",
        tsMs: DAY_START + 2000,
        orderId: "dp-NVDA-abc",
        decision: {
          scope: "tradier-strict",
          block: "per-trade risk $60 exceeds 1% cap",
        },
      }),
      row(3, DAY_START + 3000, {
        type: "PlanLoaded",
        tsMs: DAY_START + 3000,
        orderCount: 2,
        path: "/tmp/b.md",
      }),
    ];
    const report = buildDailyReport(rows, { startMs: DAY_START, endMs: DAY_END });
    const md = renderDailyReport(report);
    expect(md).toMatch(/### Alerts fired/);
    expect(md).toMatch(/\| mancini \| HIGH \| 1/);
    expect(md).toMatch(/### Governor blocks/);
    expect(md).toMatch(/per-trade risk .* NVDA/);
    expect(md).toMatch(/1 plan reloads/);
  });
});

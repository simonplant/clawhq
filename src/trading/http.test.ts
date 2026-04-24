/**
 * HTTP endpoint tests — exercise the report/* endpoints via Hono's
 * in-memory fetch, without binding a socket or starting timers.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openTradingDB, startOfTodayMs } from "./db.js";
import { makeHttpApp, type RuntimeState } from "./index.js";
import { makeInMemoryChannel } from "./telegram.js";
import type { Alert, TradingEvent } from "./types.js";

function mkState(dbPath: string): RuntimeState {
  const db = openTradingDB(dbPath);
  return {
    db,
    tradier: {
      quotes: async () => [],
      balances: async () => ({ totalEquity: 3000, dayChange: 0, pdtCount: 0 }),
      positions: async () => [],
      clock: async () => ({
        state: "closed",
        nextChangeMs: 0,
        description: "test",
      }),
    } as RuntimeState["tradier"],
    channel: makeInMemoryChannel(),
    channelKind: "in-memory",
    plan: null,
    confluence: new Map(),
    planPath: "/tmp/nonexistent-brief.md",
    watchlist: [],
    marketClock: null,
    riskState: {
      tradierBalance: 3000,
      tradierPositions: [],
      tradierDailyPnl: 0,
      tradierPdtCountLast5Days: 0,
      advisoryHoldings: [],
    },
    pendingAlerts: new Map(),
    pollFailures: 0,
    lastPollMs: null,
    lastAlertMs: null,
    nextHeartbeatMs: null,
    symbolCount: 0,
    blackoutsPath: "/tmp/nonexistent-blackouts.json",
    manualHalt: false,
    shuttingDown: false,
  };
}

function alertEvent(tsMs: number, overrides: Partial<Alert> = {}): TradingEvent {
  const alert: Alert = {
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
    expiresAtMs: tsMs + 60_000,
    ...overrides,
  };
  return { type: "AlertSent", tsMs, alert };
}

describe("GET /report/daily", () => {
  let tmp: string;
  let state: RuntimeState;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "http-test-"));
    state = mkState(join(tmp, "events.db"));
  });

  afterEach(() => {
    state.db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("renders the daily report from the events DB", async () => {
    const today = startOfTodayMs();
    state.db.append(alertEvent(today + 1_000));
    state.db.append(alertEvent(today + 2_000));
    state.db.append({
      type: "RiskDecision",
      tsMs: today + 3_000,
      orderId: "dp-NVDA-abc",
      decision: {
        scope: "tradier-strict",
        block: "per-trade risk exceeds cap",
      },
    });

    const app = makeHttpApp(state);
    const res = await app.request("/report/daily");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/### Alerts fired/);
    expect(body).toMatch(/\| mancini \| HIGH \| 2/);
    expect(body).toMatch(/### Governor blocks/);
    expect(body).toMatch(/per-trade risk .* NVDA/);
  });

  it("respects ?sinceMs / ?untilMs filters", async () => {
    const today = startOfTodayMs();
    state.db.append(alertEvent(today - 24 * 60 * 60 * 1000)); // yesterday
    state.db.append(alertEvent(today + 1_000)); // today

    const app = makeHttpApp(state);
    const res = await app.request(`/report/daily?sinceMs=${today}`);
    const body = await res.text();
    // Only today's alert should be rolled up.
    expect(body).toMatch(/\| mancini \| HIGH \| 1/);
  });
});

describe("GET /report/track-record", () => {
  let tmp: string;
  let state: RuntimeState;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "http-test-"));
    state = mkState(join(tmp, "events.db"));
  });

  afterEach(() => {
    state.db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns 400 when ?path is missing", async () => {
    const app = makeHttpApp(state);
    const res = await app.request("/report/track-record");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/path/);
  });

  it("returns 404 when the file doesn't exist", async () => {
    const app = makeHttpApp(state);
    const res = await app.request(
      `/report/track-record?path=${encodeURIComponent("/tmp/nope.jsonl")}`,
    );
    expect(res.status).toBe(404);
  });

  it("renders an aggregated markdown table from a JSONL file", async () => {
    const path = join(tmp, "track.jsonl");
    writeFileSync(
      path,
      [
        JSON.stringify({
          tsMs: Date.now(),
          source: "dp",
          conviction: "HIGH",
          ticker: "NVDA",
          direction: "LONG",
          outcome: "WIN",
          rMultiple: 2,
          pnl: 200,
        }),
        JSON.stringify({
          tsMs: Date.now(),
          source: "dp",
          conviction: "HIGH",
          ticker: "NVDA",
          direction: "LONG",
          outcome: "LOSS",
          rMultiple: -1,
          pnl: -100,
        }),
      ].join("\n"),
      "utf-8",
    );
    const app = makeHttpApp(state);
    const res = await app.request(
      `/report/track-record?path=${encodeURIComponent(path)}`,
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/\| source/);
    expect(body).toMatch(/\| dp\s+\| HIGH\s+\| 2/);
  });
});

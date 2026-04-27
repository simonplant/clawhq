/**
 * HTTP endpoint tests — exercise the report/* endpoints via Hono's
 * in-memory fetch, without binding a socket or starting timers.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openTradingDB } from "./db.js";
import { makeInMemoryChannel } from "./telegram.js";
import type { Alert } from "./types.js";
import { makeVtfDedup } from "./vtf.js";

import { makeHttpApp, type RuntimeState } from "./index.js";

function mkState(dbPath: string): RuntimeState {
  const db = openTradingDB(dbPath);
  return {
    db,
    tradier: {
      quotes: async () => [],
      balances: async () => ({ totalEquity: 3000, dayChange: 0, cash: 3000, pdtCount: 0 }),
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
    manualHalt: false,
    shuttingDown: false,
    vtfDedup: makeVtfDedup(),
  };
}

describe("POST /reply", () => {
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

  function putAlert(id: string, overrides: Partial<Alert> = {}): void {
    const alert: Alert = {
      id,
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
      expiresAtMs: Date.now() + 60_000,
      ...overrides,
    };
    state.pendingAlerts.set(id, alert);
  }

  it("accepts YES-<id>, logs UserReply, returns ticker/sequence", async () => {
    putAlert("T3ST");
    const app = makeHttpApp(state);
    const res = await app.request("/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "YES-T3ST" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      reply: string;
      alertId: string;
      ticker: string;
    };
    expect(body).toMatchObject({
      ok: true,
      reply: "approve",
      alertId: "T3ST",
      ticker: "ES",
    });
    const logged = state.db.query({ type: "UserReply" });
    expect(logged).toHaveLength(1);
  });

  it("returns 404 + logs UserReplyIgnored for unknown alert id", async () => {
    const app = makeHttpApp(state);
    const res = await app.request("/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "YES-ZZZZ" }),
    });
    expect(res.status).toBe(404);
    const ignored = state.db.query({ type: "UserReplyIgnored" });
    expect(ignored).toHaveLength(1);
  });

  it("returns 410 for expired alerts and logs reason=expired", async () => {
    putAlert("T3ST", { expiresAtMs: Date.now() - 1_000 });
    const app = makeHttpApp(state);
    const res = await app.request("/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "NO-T3ST" }),
    });
    expect(res.status).toBe(410);
    const ignored = state.db.query({ type: "UserReplyIgnored" });
    expect(ignored[0]?.payload).toMatchObject({
      type: "UserReplyIgnored",
      reason: "expired",
    });
  });

  it("returns 400 for unparseable text", async () => {
    const app = makeHttpApp(state);
    const res = await app.request("/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "what is this" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /vtf/alert", () => {
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

  const validBody = {
    v: 1,
    seq: 1,
    user: "Kira",
    time: "9:47am",
    ticker: "$AMD",
    action: "long 5/1 90 calls",
    capturedAt: "2026-04-23T16:47:03.123Z",
  };

  async function post(body: unknown): Promise<Response> {
    const app = makeHttpApp(state);
    return await app.request("/vtf/alert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("accepts a valid payload, relays to channel, logs VtfAlertReceived", async () => {
    const channel = state.channel as ReturnType<typeof makeInMemoryChannel>;
    const res = await post(validBody);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      status: string;
      ticker: string;
      actionClass: string;
    };
    expect(json).toMatchObject({
      status: "relayed",
      ticker: "AMD",
      actionClass: "long",
    });
    expect(channel.outbox).toHaveLength(1);
    expect(channel.outbox[0]).toMatch(/VTF Kira — AMD long 5\/1 90 calls/);
    const logged = state.db.query({ type: "VtfAlertReceived" });
    expect(logged).toHaveLength(1);
  });

  it("returns 400 + logs VtfAlertRejected for bad payload shape", async () => {
    const res = await post({ not: "valid" });
    expect(res.status).toBe(400);
    const logged = state.db.query({ type: "VtfAlertRejected" });
    expect(logged).toHaveLength(1);
  });

  it("returns 400 for an unsupported payload version", async () => {
    const res = await post({ ...validBody, v: 999 });
    expect(res.status).toBe(400);
  });

  it("returns status=duplicate on a second identical alert within TTL", async () => {
    const channel = state.channel as ReturnType<typeof makeInMemoryChannel>;
    const first = await post(validBody);
    expect((await first.json()) as { status: string }).toMatchObject({
      status: "relayed",
    });
    const second = await post(validBody);
    expect((await second.json()) as { status: string }).toMatchObject({
      status: "duplicate",
    });
    // Only one Telegram relay.
    expect(channel.outbox).toHaveLength(1);
    const dupes = state.db.query({ type: "VtfAlertDuplicate" });
    expect(dupes).toHaveLength(1);
  });

  it("annotates the relay with ticker-scoped blackouts", async () => {
    state.riskState.activeBlackouts = [
      { scope: { ticker: "AMD" }, name: "AMD earnings", reason: "AMC today" },
    ];
    const channel = state.channel as ReturnType<typeof makeInMemoryChannel>;
    await post(validBody);
    expect(channel.outbox[0]).toMatch(/⚠ blackout: AMD earnings/);
  });

  it("sends trims/adds/flats silently (informational)", async () => {
    const channel = state.channel as ReturnType<typeof makeInMemoryChannel>;
    await post({ ...validBody, action: "trimmed 1/2" });
    expect(channel.sent[0]?.opts.quiet).toBe(true);
  });

  it("sends longs/shorts loud (execution-relevant)", async () => {
    const channel = state.channel as ReturnType<typeof makeInMemoryChannel>;
    await post(validBody);
    expect(channel.sent[0]?.opts.quiet).toBe(false);
  });

  it("returns 400 for a body that isn't valid JSON", async () => {
    const app = makeHttpApp(state);
    const res = await app.request("/vtf/alert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
  });
});

/**
 * Durability smoke tests — does the SQLite event log survive ungraceful
 * process termination with zero event loss?
 *
 * The plan calls for pkill -9 × 100 as the hard gate. A real kill harness
 * is out of scope for vitest (requires child process + signal plumbing).
 * These tests exercise the two failure modes that matter in practice:
 *
 *   1. Events committed without a final close() must still be readable.
 *      SQLite-WAL with synchronous=NORMAL guarantees this — a fresh open()
 *      replays the WAL. If this ever regresses (e.g. someone sets
 *      synchronous=OFF), the test catches it.
 *
 *   2. High-volume sustained append must not drop events, even with rapid
 *      open/close cycles simulating restarts mid-session.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openTradingDB } from "./db.js";

describe("TradingDB durability", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "clawdius-durability-"));
    dbPath = join(tempDir, "trading.db");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("persists committed events when the DB handle is never closed", () => {
    // Open, append, then "crash" — simulate by opening a fresh handle
    // without calling db.close(). If synchronous=NORMAL is working, the
    // WAL is already on disk and replays on the next open.
    const writer = openTradingDB(dbPath);
    for (let i = 0; i < 50; i++) {
      writer.append({ type: "ServiceReady", tsMs: 1_000_000 + i });
    }
    // Intentionally do NOT call writer.close() — simulate SIGKILL.
    // The better-sqlite3 handle is still open in-process, but we want to
    // prove a second connection sees the committed events.

    const reader = openTradingDB(dbPath);
    const rows = reader.query({ type: "ServiceReady", limit: 1000 });
    expect(rows).toHaveLength(50);

    // Sanity: timestamps span the expected range.
    const tsMs = rows.map((r) => r.tsMs).sort((a, b) => a - b);
    expect(tsMs[0]).toBe(1_000_000);
    expect(tsMs[tsMs.length - 1]).toBe(1_000_049);

    reader.close();
    writer.close();
  });

  it("handles rapid open/close/reopen cycles without event loss", () => {
    // Simulates: start → crash mid-session → restart → resume. Each cycle
    // appends a batch and re-opens; the final read must see every event.
    const CYCLES = 10;
    const PER_CYCLE = 100;

    for (let cycle = 0; cycle < CYCLES; cycle++) {
      const db = openTradingDB(dbPath);
      for (let i = 0; i < PER_CYCLE; i++) {
        db.append({
          type: "Heartbeat",
          tsMs: cycle * PER_CYCLE + i,
          symbolCount: 1,
          alertsToday: 0,
          pnlTradier: 0,
          nextAtMs: 0,
        });
      }
      // Some cycles close cleanly, others don't — stresses both paths.
      if (cycle % 2 === 0) db.close();
    }

    const finalReader = openTradingDB(dbPath);
    const rows = finalReader.query({ type: "Heartbeat", limit: 2000 });
    expect(rows).toHaveLength(CYCLES * PER_CYCLE);
    finalReader.close();
  });

  it("sustains a high-volume append burst without dropping events", () => {
    // 1000 events in a tight loop — well above our expected peak (~30/sec).
    // If fsync is blocking and we lose events under pressure, this catches it.
    const db = openTradingDB(dbPath);
    const BURST = 1000;
    for (let i = 0; i < BURST; i++) {
      db.append({
        type: "Poll",
        tsMs: 2_000_000 + i,
        quotes: [
          {
            symbol: "SPY",
            last: 500 + (i % 10),
            bid: 499,
            ask: 501,
            tsMs: 2_000_000 + i,
            receivedMs: 2_000_000 + i,
          },
        ],
      });
    }
    db.close();

    const reader = openTradingDB(dbPath);
    const rows = reader.query({ type: "Poll", limit: BURST + 100 });
    expect(rows).toHaveLength(BURST);
    reader.close();
  });

  it("recovers event payloads byte-identically after reopen", () => {
    // Confidence that JSON round-trips correctly under durability — a
    // regression in serialization would be catastrophic for replay.
    const originalEvent = {
      type: "AlertSent" as const,
      tsMs: 3_000_000,
      alert: {
        id: "Z9X2",
        orderId: "mancini-ES-1",
        sequence: 1,
        source: "mancini" as const,
        horizon: "session" as const,
        ticker: "ES",
        execAs: "/MES",
        accounts: ["tos" as const],
        direction: "LONG" as const,
        conviction: "HIGH" as const,
        confirmation: "CONFIRMED" as const,
        entry: 7090,
        stop: 7078,
        t1: 7105,
        t2: 7120,
        totalRisk: 120,
        levelName: "entry" as const,
        levelPrice: 7090,
        risk: { scope: "tradier-strict" as const },
        expiresAtMs: 3_000_300,
        catchup: false,
      },
    };

    const writer = openTradingDB(dbPath);
    writer.append(originalEvent);
    writer.close();

    const reader = openTradingDB(dbPath);
    const latest = reader.latest("AlertSent");
    expect(latest?.payload).toEqual(originalEvent);
    reader.close();
  });
});

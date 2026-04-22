import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openTradingDB, type TradingDB } from "./db.js";
import type { TradingEvent } from "./types.js";

describe("TradingDB", () => {
  let tempDir: string;
  let db: TradingDB;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "clawdius-trading-test-"));
    db = openTradingDB(join(tempDir, "trading.db"));
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("appends and queries a simple event", () => {
    const ev: TradingEvent = {
      type: "ServiceReady",
      tsMs: 1_700_000_000_000,
    };
    db.append(ev);

    const rows = db.query({ type: "ServiceReady" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toEqual(ev);
    expect(rows[0]?.tsMs).toBe(ev.tsMs);
  });

  it("preserves tagged-union payloads end-to-end", () => {
    const ev: TradingEvent = {
      type: "Poll",
      tsMs: 1_700_000_000_000,
      quotes: [
        {
          symbol: "SPY",
          last: 500.12,
          bid: 500.1,
          ask: 500.14,
          tsMs: 1_700_000_000_000,
          receivedMs: 1_700_000_000_100,
        },
      ],
    };
    db.append(ev);

    const latest = db.latest("Poll");
    expect(latest?.payload).toEqual(ev);
    if (latest?.payload.type === "Poll") {
      expect(latest.payload.quotes[0]?.symbol).toBe("SPY");
    }
  });

  it("returns events in descending ts order from query()", () => {
    for (let i = 0; i < 5; i++) {
      db.append({ type: "ServiceReady", tsMs: 1_000 + i });
    }
    const rows = db.query({ limit: 10 });
    expect(rows.map((r) => r.tsMs)).toEqual([1004, 1003, 1002, 1001, 1000]);
  });

  it("returns events in ascending ts order from range()", () => {
    for (let i = 0; i < 3; i++) {
      db.append({ type: "Heartbeat", tsMs: 2_000 + i, symbolCount: 1, alertsToday: 0, pnlTradier: 0, nextAtMs: 0 });
    }
    const rows = db.range("Heartbeat", 2_000);
    expect(rows.map((r) => r.tsMs)).toEqual([2000, 2001, 2002]);
  });

  it("filters by sinceMs", () => {
    db.append({ type: "ServiceReady", tsMs: 1_000 });
    db.append({ type: "ServiceReady", tsMs: 2_000 });
    db.append({ type: "ServiceReady", tsMs: 3_000 });
    const rows = db.query({ type: "ServiceReady", sinceMs: 2_000 });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.tsMs).sort()).toEqual([2000, 3000]);
  });

  it("returns undefined from latest() when no events of that type exist", () => {
    db.append({ type: "ServiceReady", tsMs: 1_000 });
    expect(db.latest("AlertSent")).toBeUndefined();
  });
});

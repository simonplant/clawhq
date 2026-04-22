/**
 * SQLite event log.
 *
 * Single-table design: `events(ts_ms, type, payload_json)`. Append-only in
 * practice — no UPDATE / DELETE in app code. Payload is JSON-serialized
 * TradingEvent. No schema registry, no migrations: add a new event variant
 * to the union and the DB accepts it.
 *
 * WAL + synchronous=NORMAL is fine at ~30 events/sec peak. Single-writer
 * invariant is upheld because this is the only write path in-process.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";

import type { EventRow, TradingEvent } from "./types.js";

// Raw row shape returned by better-sqlite3 before JSON decode.
interface RawRow {
  id: number;
  tsMs: number;
  type: string;
  payloadJson: string;
}

export interface TradingDB {
  append(event: TradingEvent): void;
  query(opts?: {
    type?: TradingEvent["type"];
    sinceMs?: number;
    limit?: number;
  }): EventRow[];
  /** Most recent event of a given type, or undefined. */
  latest(type: TradingEvent["type"]): EventRow | undefined;
  /** All events of a type in `[startMs, now]`, ascending. */
  range(type: TradingEvent["type"], startMs: number): EventRow[];
  close(): void;
}

export function openTradingDB(dbPath: string): TradingDB {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts_ms INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_type_ts ON events(type, ts_ms DESC);
    CREATE INDEX IF NOT EXISTS events_ts ON events(ts_ms DESC);
  `);

  const insertStmt = db.prepare(
    "INSERT INTO events (ts_ms, type, payload_json) VALUES (?, ?, ?)",
  );

  const queryAllStmt = db.prepare(
    "SELECT id, ts_ms AS tsMs, type, payload_json AS payloadJson FROM events ORDER BY ts_ms DESC LIMIT ?",
  );
  const queryByTypeStmt = db.prepare(
    "SELECT id, ts_ms AS tsMs, type, payload_json AS payloadJson FROM events WHERE type = ? ORDER BY ts_ms DESC LIMIT ?",
  );
  const querySinceStmt = db.prepare(
    "SELECT id, ts_ms AS tsMs, type, payload_json AS payloadJson FROM events WHERE ts_ms >= ? ORDER BY ts_ms DESC LIMIT ?",
  );
  const queryByTypeSinceStmt = db.prepare(
    "SELECT id, ts_ms AS tsMs, type, payload_json AS payloadJson FROM events WHERE type = ? AND ts_ms >= ? ORDER BY ts_ms DESC LIMIT ?",
  );
  const latestByTypeStmt = db.prepare(
    "SELECT id, ts_ms AS tsMs, type, payload_json AS payloadJson FROM events WHERE type = ? ORDER BY ts_ms DESC LIMIT 1",
  );
  const rangeByTypeStmt = db.prepare(
    "SELECT id, ts_ms AS tsMs, type, payload_json AS payloadJson FROM events WHERE type = ? AND ts_ms >= ? ORDER BY ts_ms ASC",
  );

  function decode(row: RawRow): EventRow {
    return {
      id: row.id,
      tsMs: row.tsMs,
      type: row.type as TradingEvent["type"],
      payload: JSON.parse(row.payloadJson) as TradingEvent,
    };
  }

  return {
    append(event: TradingEvent): void {
      const tsMs = event.tsMs;
      insertStmt.run(tsMs, event.type, JSON.stringify(event));
    },

    query(opts = {}): EventRow[] {
      const limit = opts.limit ?? 1000;
      const rows: RawRow[] =
        opts.type !== undefined && opts.sinceMs !== undefined
          ? (queryByTypeSinceStmt.all(opts.type, opts.sinceMs, limit) as RawRow[])
          : opts.type !== undefined
            ? (queryByTypeStmt.all(opts.type, limit) as RawRow[])
            : opts.sinceMs !== undefined
              ? (querySinceStmt.all(opts.sinceMs, limit) as RawRow[])
              : (queryAllStmt.all(limit) as RawRow[]);
      return rows.map(decode);
    },

    latest(type): EventRow | undefined {
      const row = latestByTypeStmt.get(type) as RawRow | undefined;
      return row ? decode(row) : undefined;
    },

    range(type, startMs): EventRow[] {
      const rows = rangeByTypeStmt.all(type, startMs) as RawRow[];
      return rows.map(decode);
    },

    close(): void {
      db.close();
    },
  };
}

/** Wall-clock ms at start of today (local TZ). */
export function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Track-record aggregation over closed-trade records.
 *
 * Closes the feedback loop on source weighting. The eod-review skill logs
 * each completed trade with source + conviction + outcome + R multiple; the
 * track-record tool appends to a rolling JSONL. This module answers the
 * question Simon has been asking his brief manually: "what's DP's hit rate
 * at HIGH conviction this month? Mancini's at MEDIUM?"
 *
 * Pure input → output. The caller reads the JSONL (workspace-local, not
 * the sidecar's concern) and hands us an array. We group, count, compute,
 * render markdown.
 */

import type { Conviction, Direction, Source } from "./types.js";

// ── Record shape ────────────────────────────────────────────────────────────

export type Outcome = "WIN" | "LOSS" | "BREAKEVEN" | "OPEN";

export interface TrackRecord {
  /** Close time (ms since epoch). Open positions use the open time. */
  tsMs: number;
  source: Source;
  conviction: Conviction;
  ticker: string;
  direction: Direction;
  /** Setup label (e.g. "failed-breakdown", "pullback-21d"). Optional. */
  setup?: string;
  outcome: Outcome;
  /** PnL / initialRisk. Positive for wins, negative for losses. */
  rMultiple?: number;
  /** Dollar PnL. */
  pnl?: number;
}

// ── Aggregation ─────────────────────────────────────────────────────────────

export interface AggregateKey {
  source: Source;
  conviction: Conviction;
}

export interface Aggregate {
  key: AggregateKey;
  count: number;
  wins: number;
  losses: number;
  breakevens: number;
  open: number;
  /** wins / (wins + losses); 0 if no closed records. */
  winRate: number;
  /** Mean R across closed records with rMultiple set. */
  avgRMultiple: number;
  /** Sum of PnL across closed records with pnl set. */
  totalPnl: number;
  /** Current streak among closed records in chronological order. */
  currentStreak: { kind: Outcome | "none"; length: number };
}

export interface AggregateOptions {
  /** If set, only records with tsMs >= this threshold are counted. */
  sinceMs?: number;
  /** If set, only records with tsMs <= this threshold are counted. */
  untilMs?: number;
}

/**
 * Group records by (source, conviction) and compute the per-group
 * aggregates. Output is sorted by conviction-rank then by source for
 * stable rendering (HIGH first, then MEDIUM, LOW, EXCLUDE).
 */
export function aggregate(
  records: TrackRecord[],
  opts: AggregateOptions = {},
): Aggregate[] {
  const filtered = records.filter((r) => {
    if (opts.sinceMs !== undefined && r.tsMs < opts.sinceMs) return false;
    if (opts.untilMs !== undefined && r.tsMs > opts.untilMs) return false;
    return true;
  });

  const byKey = new Map<string, TrackRecord[]>();
  for (const r of filtered) {
    const k = `${r.source}|${r.conviction}`;
    const bucket = byKey.get(k);
    if (bucket) bucket.push(r);
    else byKey.set(k, [r]);
  }

  const out: Aggregate[] = [];
  for (const [k, rows] of byKey) {
    const [source, conviction] = k.split("|") as [Source, Conviction];
    out.push(summarize({ source, conviction }, rows));
  }

  return out.sort(compareAggregates);
}

function summarize(key: AggregateKey, rows: TrackRecord[]): Aggregate {
  let wins = 0;
  let losses = 0;
  let breakevens = 0;
  let open = 0;
  let rSum = 0;
  let rCount = 0;
  let pnlSum = 0;

  for (const r of rows) {
    switch (r.outcome) {
      case "WIN":
        wins++;
        break;
      case "LOSS":
        losses++;
        break;
      case "BREAKEVEN":
        breakevens++;
        break;
      case "OPEN":
        open++;
        break;
    }
    if (r.rMultiple !== undefined && r.outcome !== "OPEN") {
      rSum += r.rMultiple;
      rCount++;
    }
    if (r.pnl !== undefined && r.outcome !== "OPEN") {
      pnlSum += r.pnl;
    }
  }

  const closed = wins + losses;
  const winRate = closed === 0 ? 0 : wins / closed;
  const avgRMultiple = rCount === 0 ? 0 : rSum / rCount;
  const currentStreak = computeStreak(rows);

  return {
    key,
    count: rows.length,
    wins,
    losses,
    breakevens,
    open,
    winRate,
    avgRMultiple,
    totalPnl: pnlSum,
    currentStreak,
  };
}

function computeStreak(rows: TrackRecord[]): Aggregate["currentStreak"] {
  // Sort ascending, walk backward from newest closed record.
  const closed = rows
    .filter((r) => r.outcome === "WIN" || r.outcome === "LOSS")
    .sort((a, b) => a.tsMs - b.tsMs);
  if (closed.length === 0) return { kind: "none", length: 0 };
  const last = closed[closed.length - 1]!;
  let length = 1;
  for (let i = closed.length - 2; i >= 0; i--) {
    if (closed[i]!.outcome === last.outcome) length++;
    else break;
  }
  return { kind: last.outcome, length };
}

const CONVICTION_RANK: Record<Conviction, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
  EXCLUDE: 3,
};

function compareAggregates(a: Aggregate, b: Aggregate): number {
  const rankDiff = CONVICTION_RANK[a.key.conviction] - CONVICTION_RANK[b.key.conviction];
  if (rankDiff !== 0) return rankDiff;
  return a.key.source.localeCompare(b.key.source);
}

// ── Rendering ───────────────────────────────────────────────────────────────

/**
 * Render a compact markdown table suitable for pasting into today.md or the
 * EOD review. Omits the streak column when every group has none.
 */
export function renderMarkdownTable(aggregates: Aggregate[]): string {
  if (aggregates.length === 0) return "_No closed trades yet._";
  const hasStreak = aggregates.some((a) => a.currentStreak.kind !== "none");
  const headers = [
    "source",
    "conviction",
    "n",
    "W",
    "L",
    "BE",
    "open",
    "win%",
    "avgR",
    "$PnL",
  ];
  if (hasStreak) headers.push("streak");

  const rows = aggregates.map((a) => {
    const base = [
      a.key.source,
      a.key.conviction,
      String(a.count),
      String(a.wins),
      String(a.losses),
      String(a.breakevens),
      String(a.open),
      formatPercent(a.winRate),
      formatR(a.avgRMultiple),
      formatUsd(a.totalPnl),
    ];
    if (hasStreak) {
      const s =
        a.currentStreak.kind === "none"
          ? "—"
          : `${a.currentStreak.kind === "WIN" ? "W" : "L"}${a.currentStreak.length}`;
      base.push(s);
    }
    return base;
  });

  const align: ("left" | "right")[] = [
    "left",
    "left",
    "right",
    "right",
    "right",
    "right",
    "right",
    "right",
    "right",
    "right",
  ];
  if (hasStreak) align.push("right");

  return renderTable(headers, rows, align);
}

function formatPercent(x: number): string {
  if (!Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(0)}%`;
}

function formatR(x: number): string {
  if (!Number.isFinite(x) || x === 0) return "—";
  const sign = x > 0 ? "+" : "";
  return `${sign}${x.toFixed(2)}R`;
}

function formatUsd(x: number): string {
  if (!Number.isFinite(x) || x === 0) return "$0";
  const sign = x < 0 ? "-" : "+";
  return `${sign}$${Math.abs(x).toFixed(0)}`;
}

function renderTable(
  headers: string[],
  rows: string[][],
  align: ("left" | "right")[],
): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const pad = (s: string, i: number): string => {
    const w = widths[i]!;
    if (align[i] === "right") return s.padStart(w, " ");
    return s.padEnd(w, " ");
  };
  const head = headers.map((h, i) => pad(h, i)).join(" | ");
  const sep = widths.map((w, i) => (align[i] === "right" ? "-".repeat(w - 1) + ":" : "-".repeat(w))).join(" | ");
  const body = rows
    .map((r) => r.map((c, i) => pad(c, i)).join(" | "))
    .join("\n");
  return `| ${head} |\n| ${sep} |\n${body.split("\n").map((l) => `| ${l} |`).join("\n")}`;
}

// ── JSONL parsing helper ───────────────────────────────────────────────────

/**
 * Parse a JSONL blob into records, skipping malformed lines with a warning
 * array. Never throws — a track-record log with one bad line shouldn't
 * break a weekly report.
 */
export function parseJsonl(text: string): {
  records: TrackRecord[];
  warnings: string[];
} {
  const records: TrackRecord[] = [];
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as Partial<TrackRecord>;
      if (!isValidRecord(parsed)) {
        warnings.push(`line ${i + 1}: missing required fields`);
        continue;
      }
      records.push(parsed);
    } catch (err) {
      warnings.push(
        `line ${i + 1}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return { records, warnings };
}

function isValidRecord(x: Partial<TrackRecord>): x is TrackRecord {
  return (
    typeof x.tsMs === "number" &&
    (x.source === "mancini" ||
      x.source === "dp" ||
      x.source === "focus25" ||
      x.source === "scanner") &&
    (x.conviction === "HIGH" ||
      x.conviction === "MEDIUM" ||
      x.conviction === "LOW" ||
      x.conviction === "EXCLUDE") &&
    typeof x.ticker === "string" &&
    (x.direction === "LONG" || x.direction === "SHORT") &&
    (x.outcome === "WIN" ||
      x.outcome === "LOSS" ||
      x.outcome === "BREAKEVEN" ||
      x.outcome === "OPEN")
  );
}

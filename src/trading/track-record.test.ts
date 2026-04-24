import { describe, expect, it } from "vitest";

import {
  aggregate,
  parseJsonl,
  renderMarkdownTable,
  type TrackRecord,
} from "./track-record.js";

function rec(overrides: Partial<TrackRecord> = {}): TrackRecord {
  return {
    tsMs: Date.UTC(2026, 3, 1),
    source: "dp",
    conviction: "HIGH",
    ticker: "AAPL",
    direction: "LONG",
    outcome: "WIN",
    rMultiple: 1.5,
    pnl: 150,
    ...overrides,
  };
}

describe("aggregate", () => {
  it("returns an empty list for no records", () => {
    expect(aggregate([])).toEqual([]);
  });

  it("groups by (source, conviction) and counts outcomes", () => {
    const rows = [
      rec({ outcome: "WIN" }),
      rec({ outcome: "WIN" }),
      rec({ outcome: "LOSS", rMultiple: -1, pnl: -100 }),
      rec({ outcome: "BREAKEVEN", rMultiple: 0, pnl: 0 }),
      rec({ outcome: "OPEN", rMultiple: undefined, pnl: undefined }),
    ];
    const out = aggregate(rows);
    expect(out).toHaveLength(1);
    const a = out[0]!;
    expect(a.key).toEqual({ source: "dp", conviction: "HIGH" });
    expect(a.count).toBe(5);
    expect(a.wins).toBe(2);
    expect(a.losses).toBe(1);
    expect(a.breakevens).toBe(1);
    expect(a.open).toBe(1);
    expect(a.winRate).toBeCloseTo(2 / 3, 3);
  });

  it("computes average R across closed records only", () => {
    const rows = [
      rec({ rMultiple: 2, outcome: "WIN" }),
      rec({ rMultiple: -1, outcome: "LOSS" }),
      rec({ rMultiple: undefined, outcome: "OPEN" }), // excluded
    ];
    const out = aggregate(rows);
    // (2 + -1) / 2 = 0.5
    expect(out[0]?.avgRMultiple).toBeCloseTo(0.5, 3);
  });

  it("sorts by conviction rank (HIGH first) then source alphabetical", () => {
    const rows = [
      rec({ source: "mancini", conviction: "MEDIUM" }),
      rec({ source: "dp", conviction: "HIGH" }),
      rec({ source: "mancini", conviction: "HIGH" }),
      rec({ source: "focus25", conviction: "LOW" }),
    ];
    const out = aggregate(rows);
    expect(out.map((a) => `${a.key.source}/${a.key.conviction}`)).toEqual([
      "dp/HIGH",
      "mancini/HIGH",
      "mancini/MEDIUM",
      "focus25/LOW",
    ]);
  });

  it("filters by sinceMs / untilMs", () => {
    const rows = [
      rec({ tsMs: 1_000 }),
      rec({ tsMs: 2_000 }),
      rec({ tsMs: 3_000 }),
    ];
    const out = aggregate(rows, { sinceMs: 2_000, untilMs: 2_500 });
    expect(out[0]?.count).toBe(1);
  });

  it("computes current streak from the most recent closed records", () => {
    const rows = [
      rec({ tsMs: 1, outcome: "LOSS" }),
      rec({ tsMs: 2, outcome: "WIN" }),
      rec({ tsMs: 3, outcome: "WIN" }),
      rec({ tsMs: 4, outcome: "WIN" }),
      rec({ tsMs: 5, outcome: "OPEN" }), // ignored for streak
    ];
    const out = aggregate(rows);
    expect(out[0]?.currentStreak).toEqual({ kind: "WIN", length: 3 });
  });

  it("reports none-streak when every record is OPEN or BREAKEVEN", () => {
    const rows = [
      rec({ tsMs: 1, outcome: "OPEN" }),
      rec({ tsMs: 2, outcome: "BREAKEVEN" }),
    ];
    const out = aggregate(rows);
    expect(out[0]?.currentStreak.kind).toBe("none");
  });
});

describe("renderMarkdownTable", () => {
  it("renders a compact table with padded columns", () => {
    const rows = [
      rec({ source: "dp", conviction: "HIGH", rMultiple: 1.5, pnl: 150 }),
      rec({
        tsMs: 2,
        source: "mancini",
        conviction: "HIGH",
        rMultiple: 2,
        pnl: 200,
      }),
    ];
    const table = renderMarkdownTable(aggregate(rows));
    expect(table).toMatch(/\| source/);
    expect(table).toMatch(/\| dp\s+\| HIGH/);
    expect(table).toMatch(/\+1\.50R|\+1\.50R/);
  });

  it("returns a friendly message when empty", () => {
    expect(renderMarkdownTable([])).toMatch(/No closed trades/);
  });

  it("omits streak column when every group has no closed records", () => {
    const rows = [rec({ outcome: "OPEN", rMultiple: undefined, pnl: undefined })];
    const table = renderMarkdownTable(aggregate(rows));
    expect(table).not.toMatch(/\| streak/);
  });
});

describe("parseJsonl", () => {
  it("parses well-formed lines and skips malformed with a warning", () => {
    const text = [
      JSON.stringify(rec({ ticker: "NVDA" })),
      "not-json",
      JSON.stringify({ tsMs: 1, source: "dp" }), // missing fields
      JSON.stringify(rec({ ticker: "META" })),
      "",
    ].join("\n");
    const { records, warnings } = parseJsonl(text);
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.ticker)).toEqual(["NVDA", "META"]);
    expect(warnings).toHaveLength(2);
  });
});

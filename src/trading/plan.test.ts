import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseOrderBlocks } from "./plan.js";
import type { OrderBlock } from "./types.js";

const GOLDEN_DIR = join(__dirname, "extract", "golden");

interface GoldenExpected {
  orders: Array<Omit<OrderBlock, "id">>;
  warnings: string[];
}

/** List paired .md / .json fixtures. */
function listGoldens(): Array<{ name: string; md: string; json: string }> {
  const files = readdirSync(GOLDEN_DIR);
  const mdFiles = files.filter((f) => f.endsWith(".md"));
  return mdFiles.map((md) => ({
    name: basename(md, ".md"),
    md: join(GOLDEN_DIR, md),
    json: join(GOLDEN_DIR, md.replace(/\.md$/, ".json")),
  }));
}

describe("parseOrderBlocks — golden files", () => {
  const goldens = listGoldens();
  expect(goldens.length).toBeGreaterThan(0);

  for (const golden of goldens) {
    it(`parses ${golden.name}`, () => {
      const source = readFileSync(golden.md, "utf-8");
      const expected = JSON.parse(
        readFileSync(golden.json, "utf-8"),
      ) as GoldenExpected;

      const actual = parseOrderBlocks(source);

      // Strip the synthesized id (depends on content hash; covered separately).
      const strippedOrders = actual.orders.map(({ id: _id, ...rest }) => rest);
      expect(strippedOrders).toEqual(expected.orders);
      expect(actual.warnings).toEqual(expected.warnings);
    });
  }
});

describe("parseOrderBlocks — edge cases", () => {
  it("handles an empty string", () => {
    const { orders, warnings } = parseOrderBlocks("");
    expect(orders).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("synthesizes a stable id from source/ticker/entry/direction", () => {
    const brief = `
ORDER 1 | HIGH | ACTIVE
  source:       mancini
  accounts:     tos
  ticker:       ES
  exec_as:      /MES
  direction:    LONG
  setup:        x
  why:          y
  entry:        7090 LMT
  stop:         7078 — flush-4
  t1:           7105 — stated
  t2:           7120 — stated
  runner:       10% trail BE after T1
  risk:         $12 | 2 /MES | $120
  confirmation: CONFIRMED
  confluence:   none
  caveat:       none
  kills:        none
  activation:   immediate
  verify:       none
`;
    const a = parseOrderBlocks(brief);
    const b = parseOrderBlocks(brief);
    expect(a.orders[0]?.id).toBeDefined();
    expect(a.orders[0]?.id).toEqual(b.orders[0]?.id);
    expect(a.orders[0]?.id).toMatch(/^mancini-ES-[0-9a-f]{8}$/);
  });

  it("continues parsing after a malformed block", () => {
    const brief = `
ORDER 1 | BOGUS | ACTIVE
  source: mancini
  ticker: ES

ORDER 2 | HIGH | ACTIVE
  source:       dp
  accounts:     tos
  ticker:       META
  exec_as:      META
  direction:    LONG
  setup:        x
  why:          y
  entry:        681 LMT
  stop:         667 — stated
  t1:           695 — stated
  t2:           707 — stated
  runner:       10% trail
  risk:         $14 | 50 | $700
  confirmation: PENDING_TA
  confluence:   none
  caveat:       none
  kills:        none
  activation:   immediate
  verify:       none
`;
    const { orders, warnings } = parseOrderBlocks(brief);
    expect(orders).toHaveLength(1);
    expect(orders[0]?.ticker).toBe("META");
    expect(warnings[0]).toMatch(/ORDER 1:.*BOGUS/);
  });
});

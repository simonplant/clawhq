import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  activeAt,
  loadActiveBlackouts,
  parseScheduledEvents,
  type ScheduledEvent,
} from "./blackouts.js";

const T = 1_700_000_000_000;

function ev(overrides: Partial<ScheduledEvent> = {}): ScheduledEvent {
  return {
    name: "FOMC",
    tsMs: T,
    scope: "all",
    reason: "rate decision 2pm",
    ...overrides,
  };
}

describe("activeAt", () => {
  it("returns empty when now is outside every window", () => {
    const out = activeAt([ev({ tsMs: T })], T - 60 * 60 * 1000); // 1h before
    expect(out).toEqual([]);
  });

  it("includes an event inside its default pre-window (15 min before)", () => {
    const out = activeAt([ev({ tsMs: T })], T - 10 * 60 * 1000);
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("FOMC");
  });

  it("includes an event inside its default post-window (60 min after)", () => {
    const out = activeAt([ev({ tsMs: T })], T + 30 * 60 * 1000);
    expect(out).toHaveLength(1);
  });

  it("respects custom windows", () => {
    const custom = ev({
      tsMs: T,
      windowBeforeMs: 60 * 60 * 1000,
      windowAfterMs: 5 * 60 * 1000,
    });
    // 30 min before — inside custom 60-min window but outside default 15.
    expect(activeAt([custom], T - 30 * 60 * 1000)).toHaveLength(1);
    // 30 min after — outside custom 5-min window.
    expect(activeAt([custom], T + 30 * 60 * 1000)).toEqual([]);
  });

  it("carries per-ticker scope through into ActiveBlackout", () => {
    const out = activeAt(
      [ev({ scope: { ticker: "NVDA" }, name: "NVDA earnings" })],
      T,
    );
    expect(out[0]?.scope).toEqual({ ticker: "NVDA" });
  });

  it("returns all events simultaneously active", () => {
    const out = activeAt(
      [ev({ name: "FOMC" }), ev({ name: "CPI", tsMs: T - 30 * 60 * 1000 })],
      T,
    );
    expect(out.map((a) => a.name).sort()).toEqual(["CPI", "FOMC"]);
  });
});

describe("parseScheduledEvents", () => {
  it("parses well-formed JSON array", () => {
    const text = JSON.stringify([
      ev({ name: "FOMC" }),
      ev({ name: "NVDA earnings", scope: { ticker: "NVDA" } }),
    ]);
    const { events, warnings } = parseScheduledEvents(text);
    expect(events).toHaveLength(2);
    expect(warnings).toEqual([]);
  });

  it("reports parse errors as warnings, not exceptions", () => {
    const { events, warnings } = parseScheduledEvents("not json");
    expect(events).toEqual([]);
    expect(warnings[0]).toMatch(/parse/);
  });

  it("rejects non-array roots", () => {
    const { events, warnings } = parseScheduledEvents(JSON.stringify({}));
    expect(events).toEqual([]);
    expect(warnings[0]).toMatch(/root/);
  });

  it("skips malformed entries but keeps good ones", () => {
    const text = JSON.stringify([
      ev({ name: "good" }),
      { name: "missing-ts" }, // no tsMs, no scope, no reason
      ev({ name: "alsogood" }),
    ]);
    const { events, warnings } = parseScheduledEvents(text);
    expect(events.map((e) => e.name)).toEqual(["good", "alsogood"]);
    expect(warnings).toHaveLength(1);
  });
});

describe("loadActiveBlackouts", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "blackouts-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns empty when the file is missing", () => {
    const out = loadActiveBlackouts(join(tmp, "absent.json"), T);
    expect(out.active).toEqual([]);
    expect(out.warnings).toEqual([]);
  });

  it("returns active blackouts from a real file", () => {
    const path = join(tmp, "blackouts.json");
    writeFileSync(
      path,
      JSON.stringify([ev({ tsMs: T, name: "FOMC" })]),
      "utf-8",
    );
    const out = loadActiveBlackouts(path, T);
    expect(out.active).toHaveLength(1);
    expect(out.active[0]?.name).toBe("FOMC");
  });

  it("returns empty when file is present but events are not active now", () => {
    const path = join(tmp, "blackouts.json");
    writeFileSync(
      path,
      JSON.stringify([ev({ tsMs: T + 24 * 60 * 60 * 1000 })]),
      "utf-8",
    );
    const out = loadActiveBlackouts(path, T);
    expect(out.active).toEqual([]);
  });

  it("reports parse warnings but never throws", () => {
    const path = join(tmp, "blackouts.json");
    writeFileSync(path, "not json", "utf-8");
    const out = loadActiveBlackouts(path, T);
    expect(out.active).toEqual([]);
    expect(out.warnings[0]).toMatch(/parse/);
  });
});

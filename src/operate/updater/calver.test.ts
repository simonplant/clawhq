import { describe, expect, it } from "vitest";

import {
  calVerInRange,
  compareCalVer,
  compareVersions,
  formatCalVer,
  parseCalVer,
  sortVersions,
} from "./calver.js";

/** Parse CalVer or throw — test helper to avoid non-null assertions. */
function mustParseCalVer(raw: string) {
  const v = parseCalVer(raw);
  if (!v) throw new Error(`parseCalVer("${raw}") returned null`);
  return v;
}

describe("parseCalVer", () => {
  it("parses CalVer with v prefix", () => {
    const v = parseCalVer("v2026.4.12");
    expect(v).toEqual({ year: 2026, minor: 4, patch: 12, raw: "v2026.4.12" });
  });

  it("parses CalVer without v prefix", () => {
    const v = parseCalVer("2026.4.12");
    expect(v).toEqual({ year: 2026, minor: 4, patch: 12, raw: "2026.4.12" });
  });

  it("parses legacy semver", () => {
    const v = parseCalVer("v0.8.7");
    expect(v).toEqual({ year: 0, minor: 8, patch: 7, raw: "v0.8.7" });
  });

  it("handles two-segment versions (defaults patch to 0)", () => {
    const v = parseCalVer("2026.4");
    expect(v).toEqual({ year: 2026, minor: 4, patch: 0, raw: "2026.4" });
  });

  it("handles edge case v2026.1.0", () => {
    const v = parseCalVer("v2026.1.0");
    expect(v).toEqual({ year: 2026, minor: 1, patch: 0, raw: "v2026.1.0" });
  });

  it("handles large patch numbers", () => {
    const v = parseCalVer("v2026.12.31");
    expect(v).toEqual({ year: 2026, minor: 12, patch: 31, raw: "v2026.12.31" });
  });

  it("returns null for empty string", () => {
    expect(parseCalVer("")).toBeNull();
  });

  it("returns null for non-numeric segments", () => {
    expect(parseCalVer("v2026.beta.1")).toBeNull();
  });

  it("returns null for too many segments", () => {
    expect(parseCalVer("v2026.4.12.1")).toBeNull();
  });

  it("returns null for single segment", () => {
    expect(parseCalVer("v2026")).toBeNull();
  });

  it("returns null for negative numbers", () => {
    expect(parseCalVer("v2026.-1.0")).toBeNull();
  });

  it("returns null for floating point", () => {
    expect(parseCalVer("v2026.4.1.5")).toBeNull();
  });
});

describe("compareCalVer", () => {
  it("detects a < b by year", () => {
    const a = mustParseCalVer("v2025.1.0");
    const b = mustParseCalVer("v2026.1.0");
    expect(compareCalVer(a, b)).toBeLessThan(0);
  });

  it("detects a < b by minor", () => {
    const a = mustParseCalVer("v2026.3.0");
    const b = mustParseCalVer("v2026.4.0");
    expect(compareCalVer(a, b)).toBeLessThan(0);
  });

  it("detects a < b by patch", () => {
    const a = mustParseCalVer("v2026.4.11");
    const b = mustParseCalVer("v2026.4.12");
    expect(compareCalVer(a, b)).toBeLessThan(0);
  });

  it("detects equality", () => {
    const a = mustParseCalVer("v2026.4.12");
    const b = mustParseCalVer("2026.4.12");
    expect(compareCalVer(a, b)).toBe(0);
  });

  it("detects a > b", () => {
    const a = mustParseCalVer("v2026.4.12");
    const b = mustParseCalVer("v2026.4.11");
    expect(compareCalVer(a, b)).toBeGreaterThan(0);
  });

  it("correctly orders CalVer vs legacy semver", () => {
    const legacy = mustParseCalVer("v0.8.7");
    const calver = mustParseCalVer("v2026.4.12");
    expect(compareCalVer(legacy, calver)).toBeLessThan(0);
  });
});

describe("compareVersions", () => {
  it("compares string versions directly", () => {
    expect(compareVersions("v2026.4.11", "v2026.4.12")).toBeLessThan(0);
    expect(compareVersions("2026.4.12", "2026.4.12")).toBe(0);
    expect(compareVersions("v2026.4.12", "v2026.4.11")).toBeGreaterThan(0);
  });

  it("handles mixed prefix/no-prefix", () => {
    expect(compareVersions("v2026.4.12", "2026.4.12")).toBe(0);
  });

  it("handles legacy semver strings", () => {
    expect(compareVersions("0.8.7", "0.8.10")).toBeLessThan(0);
  });

  it("fallback handles four-segment versions", () => {
    expect(compareVersions("1.2.3.4", "1.2.3.5")).toBeLessThan(0);
  });
});

describe("calVerInRange", () => {
  const from = mustParseCalVer("v2026.4.9");
  const to = mustParseCalVer("v2026.4.12");

  it("returns true for version in range", () => {
    expect(calVerInRange(mustParseCalVer("v2026.4.10"), from, to)).toBe(true);
    expect(calVerInRange(mustParseCalVer("v2026.4.11"), from, to)).toBe(true);
  });

  it("returns true for version equal to upper bound (inclusive)", () => {
    expect(calVerInRange(mustParseCalVer("v2026.4.12"), from, to)).toBe(true);
  });

  it("returns false for version equal to lower bound (exclusive)", () => {
    expect(calVerInRange(mustParseCalVer("v2026.4.9"), from, to)).toBe(false);
  });

  it("returns false for version below range", () => {
    expect(calVerInRange(mustParseCalVer("v2026.4.8"), from, to)).toBe(false);
  });

  it("returns false for version above range", () => {
    expect(calVerInRange(mustParseCalVer("v2026.4.13"), from, to)).toBe(false);
  });
});

describe("formatCalVer", () => {
  it("formats to vYYYY.M.PATCH", () => {
    expect(formatCalVer({ year: 2026, minor: 4, patch: 12, raw: "" })).toBe("v2026.4.12");
  });

  it("preserves zero patch", () => {
    expect(formatCalVer({ year: 2026, minor: 1, patch: 0, raw: "" })).toBe("v2026.1.0");
  });
});

describe("sortVersions", () => {
  it("sorts from oldest to newest", () => {
    const input = ["v2026.4.12", "v0.8.7", "v2026.4.9", "v2026.3.1"];
    expect(sortVersions(input)).toEqual([
      "v0.8.7",
      "v2026.3.1",
      "v2026.4.9",
      "v2026.4.12",
    ]);
  });

  it("does not mutate input", () => {
    const input = ["v2026.4.12", "v2026.4.9"];
    sortVersions(input);
    expect(input).toEqual(["v2026.4.12", "v2026.4.9"]);
  });
});

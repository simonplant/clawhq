import { describe, expect, it } from "vitest";

import { parseDimensions } from "./types.js";

const VALID_DIMS = {
  directness: 3,
  warmth: 4,
  verbosity: 2,
  proactivity: 3,
  caution: 3,
  formality: 2,
  analyticalDepth: 3,
};

describe("parseDimensions", () => {
  it("returns PersonalityDimensions for a valid 7-dimension record", () => {
    const result = parseDimensions(VALID_DIMS);
    expect(result).toEqual(VALID_DIMS);
  });

  it("throws listing missing keys when keys are absent", () => {
    expect(() => parseDimensions({ warmth: 3 })).toThrow(/missing key: directness/);
    expect(() => parseDimensions({ warmth: 3 })).toThrow(/missing key: verbosity/);
  });

  it("throws for out-of-range values (0, 6, 99)", () => {
    expect(() => parseDimensions({ ...VALID_DIMS, warmth: 0 })).toThrow(/warmth.*1-5.*got 0/);
    expect(() => parseDimensions({ ...VALID_DIMS, warmth: 6 })).toThrow(/warmth.*1-5.*got 6/);
    expect(() => parseDimensions({ ...VALID_DIMS, warmth: 99 })).toThrow(/warmth.*1-5.*got 99/);
  });

  it("throws for extra unknown keys", () => {
    expect(() => parseDimensions({ ...VALID_DIMS, typo: 3 })).toThrow(/unknown key: typo/);
  });

  it("reports both missing keys and out-of-range values together", () => {
    // AC: parseDimensions({ warmth: 99 }) throws mentioning missing keys AND out-of-range
    expect(() => parseDimensions({ warmth: 99 })).toThrow(/missing key: directness/);
    expect(() => parseDimensions({ warmth: 99 })).toThrow(/warmth.*1-5.*got 99/);
  });

  it("throws for non-integer values", () => {
    expect(() => parseDimensions({ ...VALID_DIMS, warmth: 2.5 })).toThrow(/warmth.*1-5.*got 2.5/);
  });
});

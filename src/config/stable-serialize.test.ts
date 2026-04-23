import { describe, expect, it } from "vitest";

import { sortedEntries } from "./stable-serialize.js";

describe("sortedEntries", () => {
  it("sorts object entries by key", () => {
    const result = sortedEntries({ z: 1, a: 2, m: 3 });
    expect(result).toEqual([["a", 2], ["m", 3], ["z", 1]]);
  });

  it("handles undefined / null input as empty", () => {
    expect(sortedEntries(undefined)).toEqual([]);
    expect(sortedEntries(null)).toEqual([]);
  });

  it("produces the same output regardless of insertion order", () => {
    const a = { b: 1 }; (a as Record<string, number>).a = 2;
    const b = { a: 2, b: 1 };
    expect(sortedEntries(a)).toEqual(sortedEntries(b));
  });
});

import { describe, expect, it } from "vitest";

import { sortedEntries, sortedKeys, stableJsonStringify } from "./stable-serialize.js";

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

describe("sortedKeys", () => {
  it("sorts keys ascending", () => {
    expect(sortedKeys({ m: 1, a: 2, z: 3 })).toEqual(["a", "m", "z"]);
  });
});

describe("stableJsonStringify", () => {
  it("emits keys in sorted order", () => {
    expect(stableJsonStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("walks nested objects", () => {
    expect(stableJsonStringify({ z: { b: 1, a: 2 }, a: 1 })).toBe(
      '{"a":1,"z":{"a":2,"b":1}}',
    );
  });

  it("leaves array order alone (order is semantic for arrays)", () => {
    expect(stableJsonStringify([3, 1, 2])).toBe("[3,1,2]");
  });

  it("supports indent parameter like JSON.stringify", () => {
    const result = stableJsonStringify({ b: 1, a: 2 }, 2);
    expect(result).toContain('"a": 2');
    expect(result).toContain('"b": 1');
    expect(result.indexOf('"a"')).toBeLessThan(result.indexOf('"b"'));
  });

  it("is byte-equal for differently-inserted equivalent inputs", () => {
    const a: Record<string, unknown> = {};
    a.z = 1; a.a = 2; a.m = { y: 1, x: 2 };
    const b: Record<string, unknown> = {};
    b.a = 2; b.m = { x: 2, y: 1 }; b.z = 1;
    expect(stableJsonStringify(a)).toBe(stableJsonStringify(b));
  });
});

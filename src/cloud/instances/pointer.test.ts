import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearCurrentPointer,
  currentPointerPath,
  readCurrentPointer,
  writeCurrentPointer,
} from "./pointer.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pointer-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("pointer", () => {
  it("returns undefined when file is missing", () => {
    expect(readCurrentPointer(root)).toBeUndefined();
  });

  it("round-trips a value", () => {
    writeCurrentPointer("clawdius", root);
    expect(readCurrentPointer(root)).toBe("clawdius");
  });

  it("trims whitespace and newlines", () => {
    writeFileSync(currentPointerPath(root), "  clawdius  \n\n");
    expect(readCurrentPointer(root)).toBe("clawdius");
  });

  it("returns undefined for empty file", () => {
    writeFileSync(currentPointerPath(root), "   \n");
    expect(readCurrentPointer(root)).toBeUndefined();
  });

  it("writes with mode 0600", () => {
    writeCurrentPointer("clawdius", root);
    expect(statSync(currentPointerPath(root)).mode & 0o777).toBe(0o600);
  });

  it("clear removes the file", () => {
    writeCurrentPointer("clawdius", root);
    clearCurrentPointer(root);
    expect(readCurrentPointer(root)).toBeUndefined();
  });

  it("clear is a no-op when file is absent", () => {
    expect(() => clearCurrentPointer(root)).not.toThrow();
  });
});

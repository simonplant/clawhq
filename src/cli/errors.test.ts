/**
 * Tests for CommandError — the core mechanism that replaces process.exit()
 * in all CLI command handlers (FEAT-106).
 */

import { describe, expect, it } from "vitest";

import { CommandError } from "./errors.js";

describe("CommandError", () => {
  it("carries an exit code (default 1)", () => {
    const err = new CommandError("something failed");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CommandError");
    expect(err.message).toBe("something failed");
    expect(err.exitCode).toBe(1);
  });

  it("accepts a custom exit code", () => {
    const err = new CommandError("cancelled", 0);
    expect(err.exitCode).toBe(0);
    expect(err.message).toBe("cancelled");
  });

  it("supports empty message for pre-printed errors", () => {
    const err = new CommandError("", 1);
    expect(err.message).toBe("");
    expect(err.exitCode).toBe(1);
  });

  it("exitCode is readonly", () => {
    const err = new CommandError("test");
    // TypeScript prevents assignment at compile time; verify the value is stable
    expect(err.exitCode).toBe(1);
  });

  it("is catchable as Error", () => {
    try {
      throw new CommandError("boom", 2);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(CommandError);
      expect((e as CommandError).exitCode).toBe(2);
    }
  });
});

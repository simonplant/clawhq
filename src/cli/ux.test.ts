/**
 * Tests for CLI UX helpers — error formatting, first-run detection.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkFirstRun, formatError, renderError } from "./ux.js";

// ── formatError ─────────────────────────────────────────────────────────────

describe("formatError", () => {
  it("formats a ConnectionError with hint", () => {
    const err = new Error("ECONNREFUSED");
    err.name = "ConnectionError";
    const result = formatError(err);
    expect(result.title).toBe("Connection failed");
    expect(result.detail).toBe("ECONNREFUSED");
    expect(result.hint).toContain("clawhq up");
  });

  it("formats an AuthError with hint", () => {
    const err = new Error("Token rejected");
    err.name = "AuthError";
    const result = formatError(err);
    expect(result.title).toBe("Authentication failed");
    expect(result.hint).toContain("token");
  });

  it("formats a RateLimitError with hint", () => {
    const err = new Error("Too many requests");
    err.name = "RateLimitError";
    const result = formatError(err);
    expect(result.title).toBe("Rate limit exceeded");
    expect(result.hint).toContain("Wait");
  });

  it("formats an RpcTimeoutError with hint", () => {
    const err = new Error("Timed out after 5000ms");
    err.name = "RpcTimeoutError";
    const result = formatError(err);
    expect(result.title).toBe("Request timed out");
    expect(result.hint).toContain("status");
  });

  it("formats a generic Error without hint", () => {
    const err = new Error("Something broke");
    const result = formatError(err);
    expect(result.title).toBe("Error");
    expect(result.detail).toBe("Something broke");
    expect(result.hint).toBeUndefined();
  });

  it("formats a non-Error value", () => {
    const result = formatError("raw string error");
    expect(result.title).toBe("Error");
    expect(result.detail).toBe("raw string error");
  });
});

// ── renderError ─────────────────────────────────────────────────────────────

describe("renderError", () => {
  it("renders error with hint on two lines", () => {
    const err = new Error("ECONNREFUSED");
    err.name = "ConnectionError";
    const output = renderError(err);
    expect(output).toContain("Connection failed");
    expect(output).toContain("ECONNREFUSED");
    expect(output).toContain("→");
  });

  it("renders generic error without hint line", () => {
    const output = renderError(new Error("oops"));
    expect(output).toContain("Error");
    expect(output).toContain("oops");
    // No hint line (no →)
    expect(output).not.toContain("→");
  });
});

// ── checkFirstRun ───────────────────────────────────────────────────────────

describe("checkFirstRun", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `clawhq-firstrun-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("returns installed=false when directory does not exist", () => {
    const result = checkFirstRun(testDir);
    expect(result.installed).toBe(false);
    expect(result.deployDir).toBe(testDir);
  });

  it("returns installed=false when directory exists but no clawhq.yaml", async () => {
    await mkdir(testDir, { recursive: true });
    const result = checkFirstRun(testDir);
    expect(result.installed).toBe(false);
  });

  it("returns installed=true when directory and clawhq.yaml exist", async () => {
    await mkdir(testDir, { recursive: true });
    await writeFile(join(testDir, "clawhq.yaml"), "version: 1\n");
    const result = checkFirstRun(testDir);
    expect(result.installed).toBe(true);
  });
});

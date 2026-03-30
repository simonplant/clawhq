/**
 * Tests for claw-secret — 1Password credential fetch utility.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchSecret, readServiceAccountToken } from "./claw-secret.js";
import type { FetchSecretOptions } from "./claw-secret.js";

// ── Test Fixtures ──────────────────────────────────────────────────────────

let testDir: string;
let tokenPath: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "clawhq-secret-test-"));
  mkdirSync(join(testDir, "secrets"), { recursive: true });
  tokenPath = join(testDir, "secrets", "op_service_account_token");
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ── readServiceAccountToken ────────────────────────────────────────────────

describe("readServiceAccountToken", () => {
  it("reads token from file", async () => {
    writeFileSync(tokenPath, "ops_test_token_123\n");

    const token = await readServiceAccountToken(tokenPath);
    expect(token).toBe("ops_test_token_123");
  });

  it("trims whitespace from token", async () => {
    writeFileSync(tokenPath, "  ops_test_token_456  \n");

    const token = await readServiceAccountToken(tokenPath);
    expect(token).toBe("ops_test_token_456");
  });

  it("returns null for empty file", async () => {
    writeFileSync(tokenPath, "");

    const token = await readServiceAccountToken(tokenPath);
    expect(token).toBeNull();
  });

  it("returns null for whitespace-only file", async () => {
    writeFileSync(tokenPath, "   \n\n  ");

    const token = await readServiceAccountToken(tokenPath);
    expect(token).toBeNull();
  });

  it("returns null when file does not exist", async () => {
    const token = await readServiceAccountToken(join(testDir, "nonexistent"));
    expect(token).toBeNull();
  });

  it("never throws", async () => {
    // Permission denied scenario — should still return null
    const token = await readServiceAccountToken("/root/not-readable");
    expect(token).toBeNull();
  });
});

// ── fetchSecret ────────────────────────────────────────────────────────────

describe("fetchSecret", () => {
  it("rejects invalid reference format", async () => {
    const result = await fetchSecret({
      reference: "not-a-valid-ref",
      tokenPath,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("op://");
    expect(result.reference).toBe("not-a-valid-ref");
    expect(result.fetchedAt).toBeTruthy();
  });

  it("fails when token file is missing", async () => {
    const result = await fetchSecret({
      reference: "op://vault/item/field",
      tokenPath: join(testDir, "nonexistent"),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("fails when token has invalid format", async () => {
    writeFileSync(tokenPath, "bad_prefix_token");

    const result = await fetchSecret({
      reference: "op://vault/item/field",
      tokenPath,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("invalid format");
    expect(result.error).toContain("ops_");
  });

  it("fails when token file is empty", async () => {
    writeFileSync(tokenPath, "");

    const result = await fetchSecret({
      reference: "op://vault/item/field",
      tokenPath,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("handles op CLI not installed", async () => {
    writeFileSync(tokenPath, "ops_valid_token");

    // op is not installed in the test environment, so this should fail gracefully
    const result = await fetchSecret({
      reference: "op://vault/item/field",
      tokenPath,
      timeoutMs: 2000,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("op read failed");
    expect(result.reference).toBe("op://vault/item/field");
  });

  it("sanitizes token from error messages", async () => {
    writeFileSync(tokenPath, "ops_secret_token_value");

    const result = await fetchSecret({
      reference: "op://vault/item/field",
      tokenPath,
      timeoutMs: 2000,
    });

    // Even if the op command fails, the token should not leak in error
    if (result.error) {
      expect(result.error).not.toContain("ops_secret_token_value");
    }
  });

  it("includes timestamp in result", async () => {
    const before = new Date().toISOString();

    const result = await fetchSecret({
      reference: "not-valid",
      tokenPath,
    });

    const after = new Date().toISOString();
    expect(result.fetchedAt >= before).toBe(true);
    expect(result.fetchedAt <= after).toBe(true);
  });

  it("never exposes credential value on failure", async () => {
    writeFileSync(tokenPath, "ops_test_token");

    const result = await fetchSecret({
      reference: "op://vault/item/field",
      tokenPath,
      timeoutMs: 2000,
    });

    expect(result.ok).toBe(false);
    expect(result.value).toBeUndefined();
  });
});

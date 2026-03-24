import { afterEach, describe, expect, it, vi } from "vitest";

import { createAwsAdapter } from "./aws.js";

describe("createAwsAdapter token parsing", () => {
  it("throws on token with no colon", () => {
    expect(() => createAwsAdapter("AKIAIOSFODNN7EXAMPLE")).toThrow(
      "AWS token must be in format ACCESS_KEY_ID:SECRET_ACCESS_KEY",
    );
  });

  it("throws on empty string", () => {
    expect(() => createAwsAdapter("")).toThrow(
      "AWS token must be in format ACCESS_KEY_ID:SECRET_ACCESS_KEY",
    );
  });

  it("throws on token with empty access key", () => {
    expect(() => createAwsAdapter(":wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY")).toThrow(
      "AWS token must be in format ACCESS_KEY_ID:SECRET_ACCESS_KEY",
    );
  });

  it("throws on token with empty secret key", () => {
    expect(() => createAwsAdapter("AKIAIOSFODNN7EXAMPLE:")).toThrow(
      "AWS token must be in format ACCESS_KEY_ID:SECRET_ACCESS_KEY",
    );
  });

  it("throws on token with whitespace-only access key", () => {
    expect(() => createAwsAdapter("  :wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY")).toThrow(
      "AWS token must be in format ACCESS_KEY_ID:SECRET_ACCESS_KEY",
    );
  });

  it("throws on token with whitespace-only secret key", () => {
    expect(() => createAwsAdapter("AKIAIOSFODNN7EXAMPLE:   ")).toThrow(
      "AWS token must be in format ACCESS_KEY_ID:SECRET_ACCESS_KEY",
    );
  });

  it("throws on token with multiple colons", () => {
    expect(() => createAwsAdapter("AKIA:secret:extra")).toThrow(
      "AWS token must be in format ACCESS_KEY_ID:SECRET_ACCESS_KEY",
    );
  });

  it("parses a valid token without error", () => {
    const adapter = createAwsAdapter("AKIAIOSFODNN7EXAMPLE:wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
    expect(adapter.provider).toBe("aws");
  });
});

describe("validateToken masking", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("masks account to first 8 chars on successful validation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<DescribeRegionsResponse><regionInfo></regionInfo></DescribeRegionsResponse>", { status: 200 }),
    );
    const adapter = createAwsAdapter("AKIAIOSFODNN7EXAMPLE:wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
    const result = await adapter.validateToken();
    expect(result.valid).toBe(true);
    expect(result.account).toBe("AKIAIOSF...");
    expect(result.account).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("does not expose full key on failed validation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<Error><Code>AuthFailure</Code></Error>", { status: 401 }),
    );
    const adapter = createAwsAdapter("AKIAIOSFODNN7EXAMPLE:wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
    const result = await adapter.validateToken();
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.account).toBeUndefined();
  });
});

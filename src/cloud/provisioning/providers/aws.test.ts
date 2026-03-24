import { describe, expect, it } from "vitest";

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

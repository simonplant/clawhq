import { describe, expect, it } from "vitest";

import { createGcpAdapter } from "./gcp.js";

describe("createGcpAdapter token parsing", () => {
  it("throws on empty string", () => {
    expect(() => createGcpAdapter("")).toThrow(
      "Invalid GCP service account JSON: token must not be empty",
    );
  });

  it("throws on whitespace-only string", () => {
    expect(() => createGcpAdapter("   ")).toThrow(
      "Invalid GCP service account JSON: token must not be empty",
    );
  });

  it("throws on truncated JSON", () => {
    expect(() => createGcpAdapter('{"project_id": "my-proj"')).toThrow(
      /^Invalid GCP service account JSON:/,
    );
  });

  it("throws on malformed JSON with extra comma", () => {
    expect(() => createGcpAdapter('{"project_id": "my-proj",}')).toThrow(
      /^Invalid GCP service account JSON:/,
    );
  });

  it("throws on non-JSON string that starts with brace", () => {
    expect(() => createGcpAdapter("{not json at all}")).toThrow(
      /^Invalid GCP service account JSON:/,
    );
  });

  it("does not expose raw JSON.parse stack trace", () => {
    try {
      createGcpAdapter('{"project_id": "my-proj"');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/^Invalid GCP service account JSON:/);
      // The message should wrap the parse error, not be a raw SyntaxError message
      expect((err as Error).message).not.toMatch(/^Unexpected end of JSON input$/);
    }
  });

  it("parses valid service account JSON without error", () => {
    const validSa = JSON.stringify({
      project_id: "my-project",
      client_email: "test@my-project.iam.gserviceaccount.com",
      private_key: "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----\n",
    });
    const adapter = createGcpAdapter(validSa);
    expect(adapter.provider).toBe("gcp");
  });

  it("parses valid PROJECT_ID:ACCESS_TOKEN format without error", () => {
    const adapter = createGcpAdapter("my-project:ya29.some-access-token");
    expect(adapter.provider).toBe("gcp");
  });
});

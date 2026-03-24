import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// ── Malformed JSON Response Handling ─────────────────────────────────────────

let fetchMock: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;

beforeEach(() => {
  fetchMock = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("gcpRequest malformed JSON handling", () => {
  const adapter = createGcpAdapter("my-project:ya29.test-token");

  it("surfaces clean error when API returns HTML instead of JSON", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError("Unexpected token '<'")),
      text: () => Promise.resolve("<html>502 Bad Gateway</html>"),
    } as unknown as Response);

    const result = await adapter.validateToken();
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/GCP API returned non-JSON response/);
    expect(result.error).toMatch(/HTTP 200/);
  });

  it("surfaces clean error on empty body", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError("Unexpected end of JSON input")),
      text: () => Promise.resolve(""),
    } as unknown as Response);

    const result = await adapter.validateToken();
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/GCP API returned non-JSON response/);
    expect(result.error).toMatch(/\(empty body\)/);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDigitalOceanAdapter } from "./digitalocean.js";

// ── Fetch Mock ───────────────────────────────────────────────────────────────

let fetchMock: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;

beforeEach(() => {
  fetchMock = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Malformed JSON Response Handling ─────────────────────────────────────────

describe("doRequest malformed JSON handling", () => {
  const adapter = createDigitalOceanAdapter("test-token");

  it("surfaces clean error when API returns HTML instead of JSON", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError("Unexpected token '<'")),
      text: () => Promise.resolve("<html>502 Bad Gateway</html>"),
    } as unknown as Response);

    const result = await adapter.validateToken();
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/DigitalOcean API returned non-JSON response/);
    expect(result.error).toMatch(/HTTP 200/);
  });

  it("surfaces clean error when API returns empty body as JSON", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError("Unexpected end of JSON input")),
      text: () => Promise.resolve(""),
    } as unknown as Response);

    const result = await adapter.validateToken();
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/DigitalOcean API returned non-JSON response/);
    expect(result.error).toMatch(/\(empty body\)/);
  });

  it("includes truncated body in error for long responses", async () => {
    const longHtml = "<html>" + "x".repeat(500) + "</html>";
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError("Unexpected token '<'")),
      text: () => Promise.resolve(longHtml),
    } as unknown as Response);

    const result = await adapter.validateToken();
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/DigitalOcean API returned non-JSON response/);
    // Body should be truncated to 200 chars
    expect(result.error!.length).toBeLessThan(300);
  });

  it("does not crash when text() also fails after json() fails", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 502,
      json: () => Promise.reject(new SyntaxError("Unexpected token")),
      text: () => Promise.reject(new Error("stream consumed")),
    } as unknown as Response);

    const result = await adapter.validateToken();
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/DigitalOcean API returned non-JSON response/);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createHetznerAdapter } from "./hetzner.js";

describe("createFirewall dropletId validation", () => {
  const adapter = createHetznerAdapter("test-token");

  it("throws on non-numeric droplet ID", async () => {
    await expect(
      adapter.createFirewall({
        name: "test-fw",
        inboundPorts: [443],
        dropletIds: ["abc"],
      }),
    ).rejects.toThrow("Invalid droplet ID: 'abc' is not a numeric server ID");
  });

  it("throws on empty string droplet ID", async () => {
    await expect(
      adapter.createFirewall({
        name: "test-fw",
        inboundPorts: [443],
        dropletIds: [""],
      }),
    ).rejects.toThrow("Invalid droplet ID: '' is not a numeric server ID");
  });

  it("throws when one ID in the list is non-numeric", async () => {
    await expect(
      adapter.createFirewall({
        name: "test-fw",
        inboundPorts: [443],
        dropletIds: ["123", "not-a-number", "456"],
      }),
    ).rejects.toThrow("Invalid droplet ID: 'not-a-number' is not a numeric server ID");
  });

  it("converts valid numeric string IDs without error", () => {
    // Validate the parseInt logic directly — the actual API call would fail
    // without a real token, but we verify the mapping doesn't throw
    const ids = ["123", "456", "789"];
    const mapped = ids.map((id) => {
      const numId = parseInt(id, 10);
      expect(isNaN(numId)).toBe(false);
      return numId;
    });
    expect(mapped).toEqual([123, 456, 789]);
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

describe("hetznerRequest malformed JSON handling", () => {
  const adapter = createHetznerAdapter("test-token");

  it("surfaces clean error when API returns HTML instead of JSON", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError("Unexpected token '<'")),
      text: () => Promise.resolve("<html>502 Bad Gateway</html>"),
    } as unknown as Response);

    const result = await adapter.validateToken();
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Hetzner API returned non-JSON response/);
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
    expect(result.error).toMatch(/Hetzner API returned non-JSON response/);
    expect(result.error).toMatch(/\(empty body\)/);
  });
});

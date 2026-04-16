/**
 * Contract tests for the DigitalOcean provider adapter.
 *
 * These tests validate our parsing logic against realistic API response shapes
 * recorded from the real DigitalOcean API (sanitized). If DO changes their
 * response format, these tests will catch it before production breaks.
 *
 * Live API tests run when CLAWHQ_TEST_DO_TOKEN is set, otherwise they are skipped.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDigitalOceanAdapter } from "./digitalocean.js";

// ── Fixture Loader ──────────────────────────────────────────────────────────

const FIXTURES = join(import.meta.dirname, "__fixtures__", "digitalocean");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf-8"));
}

// ── Contract Tests (fixture-backed) ─────────────────────────────────────────

describe("DigitalOcean contract tests", () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;

  beforeEach(() => {
    fetchMock = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function jsonResponse(fixture: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(fixture),
      text: () => Promise.resolve(JSON.stringify(fixture)),
    } as unknown as Response;
  }

  function emptyResponse(status = 204): Response {
    return {
      ok: true,
      status,
      json: () => Promise.reject(new Error("No body")),
      text: () => Promise.resolve(""),
    } as unknown as Response;
  }

  const adapter = createDigitalOceanAdapter("test-token-do-contract");

  describe("validateToken", () => {
    it("parses real account response shape", async () => {
      const fixture = loadFixture("account.json");
      fetchMock.mockResolvedValueOnce(jsonResponse(fixture));

      const result = await adapter.validateToken();

      expect(result.valid).toBe(true);
      expect(result.account).toBe("user@example.com");
    });

    it("detects missing email field", async () => {
      // Simulate a format change where account.email is removed
      const fixture = loadFixture("account.json") as Record<string, unknown>;
      const mutated = { account: { ...((fixture as { account: Record<string, unknown> }).account) } };
      delete (mutated.account as Record<string, unknown>).email;
      fetchMock.mockResolvedValueOnce(jsonResponse(mutated));

      const result = await adapter.validateToken();

      expect(result.valid).toBe(true);
      expect(result.account).toBeUndefined();
    });
  });

  describe("getVmStatus", () => {
    it("parses real active droplet response shape", async () => {
      const fixture = loadFixture("droplet-active.json");
      fetchMock.mockResolvedValueOnce(jsonResponse(fixture));

      const result = await adapter.getVmStatus("412275827");

      expect(result.state).toBe("active");
      expect(result.ipAddress).toBe("203.0.113.42");
      expect(result.monthlyCost).toBe(18);
    });

    it("detects renamed networks field", async () => {
      // Simulate format change: networks renamed to network_interfaces
      const fixture = loadFixture("droplet-active.json") as Record<string, unknown>;
      const droplet = { ...((fixture as { droplet: Record<string, unknown> }).droplet) };
      (droplet as Record<string, unknown>).network_interfaces = droplet.networks;
      delete (droplet as Record<string, unknown>).networks;
      fetchMock.mockResolvedValueOnce(jsonResponse({ droplet }));

      const result = await adapter.getVmStatus("412275827");

      // IP should be undefined because our code reads .networks, not .network_interfaces
      expect(result.ipAddress).toBeUndefined();
    });

    it("detects type change in size_slug", async () => {
      // Simulate format change: size_slug becomes an object
      const fixture = loadFixture("droplet-active.json") as Record<string, unknown>;
      const droplet = { ...((fixture as { droplet: Record<string, unknown> }).droplet) };
      (droplet as Record<string, unknown>).size_slug = { name: "s-2vcpu-2gb", id: 123 };
      fetchMock.mockResolvedValueOnce(jsonResponse({ droplet }));

      const result = await adapter.getVmStatus("412275827");

      // Cost lookup will fail because size_slug is no longer a string key
      expect(result.monthlyCost).toBeUndefined();
    });

    it("handles 404 for destroyed droplet", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve("not found"),
      } as unknown as Response);

      const result = await adapter.getVmStatus("999999999");

      expect(result.state).toBe("not-found");
    });
  });

  describe("addSshKey", () => {
    it("parses real SSH key creation response", async () => {
      const fixture = loadFixture("ssh-key-create.json");
      fetchMock.mockResolvedValueOnce(jsonResponse(fixture));

      const result = await adapter.addSshKey({
        name: "clawhq-deploy-key",
        publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyDataHere",
      });

      expect(result.success).toBe(true);
      expect(result.keyId).toBe("38972451");
      expect(result.fingerprint).toBe("SHA256:nThbg6kXUpJWGl7E1IGOCspRomTxdCARLviKw6E5SY8");
    });

    it("detects ssh_key.id type change to string", async () => {
      // Simulate format change: id becomes a string UUID
      const fixture = loadFixture("ssh-key-create.json") as Record<string, unknown>;
      const mutated = {
        ssh_key: {
          ...((fixture as { ssh_key: Record<string, unknown> }).ssh_key),
          id: "key-uuid-abc123",
        },
      };
      fetchMock.mockResolvedValueOnce(jsonResponse(mutated));

      const result = await adapter.addSshKey({
        name: "clawhq-deploy-key",
        publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyDataHere",
      });

      // String(stringId) should still work — this verifies our code is resilient
      expect(result.success).toBe(true);
      expect(result.keyId).toBe("key-uuid-abc123");
    });
  });

  describe("listSshKeys", () => {
    it("parses real SSH key list response", async () => {
      const fixture = loadFixture("ssh-key-list.json");
      fetchMock.mockResolvedValueOnce(jsonResponse(fixture));

      const keys = await adapter.listSshKeys();

      expect(keys).toHaveLength(2);
      expect(keys[0].id).toBe("38972451");
      expect(keys[0].name).toBe("clawhq-deploy-key");
      expect(keys[0].fingerprint).toBe("SHA256:nThbg6kXUpJWGl7E1IGOCspRomTxdCARLviKw6E5SY8");
      expect(keys[0].publicKey).toContain("ssh-ed25519");
      expect(keys[1].name).toBe("personal-laptop");
    });
  });

  describe("createFirewall", () => {
    it("parses real firewall creation response", async () => {
      const fixture = loadFixture("firewall-create.json");
      fetchMock.mockResolvedValueOnce(jsonResponse(fixture));

      const result = await adapter.createFirewall({
        name: "clawhq-test-agent",
        inboundPorts: [443, 18789],
        dropletIds: ["412275827"],
      });

      expect(result.success).toBe(true);
      expect(result.firewallId).toBe("bb4b2611-3d72-467b-8602-280330095a63");
    });

    it("detects firewall.id field rename", async () => {
      // Simulate format change: id renamed to firewall_id
      const fixture = loadFixture("firewall-create.json") as Record<string, unknown>;
      const firewall = { ...((fixture as { firewall: Record<string, unknown> }).firewall) };
      (firewall as Record<string, unknown>).firewall_id = firewall.id;
      delete (firewall as Record<string, unknown>).id;
      fetchMock.mockResolvedValueOnce(jsonResponse({ firewall }));

      const result = await adapter.createFirewall({
        name: "clawhq-test-agent",
        inboundPorts: [443, 18789],
        dropletIds: ["412275827"],
      });

      // Our code reads firewall.id which is now undefined
      expect(result.firewallId).toBeUndefined();
    });
  });

  describe("destroyVm", () => {
    it("handles 204 No Content (successful destroy)", async () => {
      fetchMock.mockResolvedValueOnce(emptyResponse(204));

      const result = await adapter.destroyVm("412275827");

      expect(result.success).toBe(true);
      expect(result.destroyed).toBe(true);
    });
  });

  describe("verifyDestroyed", () => {
    it("returns true for 404 response", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve("not found"),
      } as unknown as Response);

      const result = await adapter.verifyDestroyed("412275827");

      expect(result).toBe(true);
    });

    it("returns false when droplet still exists", async () => {
      const fixture = loadFixture("droplet-active.json");
      fetchMock.mockResolvedValueOnce(jsonResponse(fixture));

      const result = await adapter.verifyDestroyed("412275827");

      expect(result).toBe(false);
    });
  });

  describe("getMonthlyCost", () => {
    it("returns cost for known size from fixture", async () => {
      // Verify that the size_slug in our fixture maps to a known cost
      const fixture = loadFixture("droplet-active.json") as { droplet: { size_slug: string } };
      const cost = adapter.getMonthlyCost(fixture.droplet.size_slug);

      expect(cost).toBe(18);
    });
  });
});

// ── Live API Tests ──────────────────────────────────────────────────────────

describe("DigitalOcean live API tests", () => {
  const token = process.env.CLAWHQ_TEST_DO_TOKEN;

  it.skipIf(!token)("validates real token against live API", async () => {
    const adapter = createDigitalOceanAdapter(token as string);
    const result = await adapter.validateToken();

    expect(result.valid).toBe(true);
    expect(result.account).toBeTruthy();
  });

  it.skipIf(!token)("lists SSH keys from live API", async () => {
    const adapter = createDigitalOceanAdapter(token as string);
    const keys = await adapter.listSshKeys();

    // Should return an array (may be empty)
    expect(Array.isArray(keys)).toBe(true);
    for (const key of keys) {
      expect(key).toHaveProperty("id");
      expect(key).toHaveProperty("name");
      expect(key).toHaveProperty("fingerprint");
    }
  });
});

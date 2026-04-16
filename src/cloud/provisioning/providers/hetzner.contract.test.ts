/**
 * Contract tests for the Hetzner Cloud provider adapter.
 *
 * Validates parsing logic against realistic API response shapes from the
 * Hetzner Cloud API (sanitized). Catches format changes before production.
 *
 * Live API tests run when CLAWHQ_TEST_HETZNER_TOKEN is set.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createHetznerAdapter } from "./hetzner.js";

// ── Fixture Loader ──────────────────────────────────────────────────────────

const FIXTURES = join(import.meta.dirname, "__fixtures__", "hetzner");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf-8"));
}

// ── Contract Tests (fixture-backed) ─────────────────────────────────────────

describe("Hetzner contract tests", () => {
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

  const adapter = createHetznerAdapter("test-token-hetzner-contract");

  describe("validateToken", () => {
    it("parses real servers list response", async () => {
      const fixture = loadFixture("servers-list.json");
      fetchMock.mockResolvedValueOnce(jsonResponse(fixture));

      const result = await adapter.validateToken();

      expect(result.valid).toBe(true);
    });
  });

  describe("getVmStatus", () => {
    it("parses real running server response", async () => {
      const fixture = loadFixture("server-running.json");
      fetchMock.mockResolvedValueOnce(jsonResponse(fixture));

      const result = await adapter.getVmStatus("54321098");

      expect(result.state).toBe("running");
      expect(result.ipAddress).toBe("203.0.113.50");
      expect(result.monthlyCost).toBe(4.51);
    });

    it("detects renamed public_net field", async () => {
      const fixture = loadFixture("server-running.json") as Record<string, unknown>;
      const server = { ...((fixture as { server: Record<string, unknown> }).server) };
      (server as Record<string, unknown>).public_network = server.public_net;
      delete (server as Record<string, unknown>).public_net;
      fetchMock.mockResolvedValueOnce(jsonResponse({ server }));

      const result = await adapter.getVmStatus("54321098");

      expect(result.state).toBe("running");
      // IP extraction fails because code reads .public_net
      expect(result.ipAddress).toBeUndefined();
    });

    it("detects server_type structure change", async () => {
      const fixture = loadFixture("server-running.json") as Record<string, unknown>;
      const server = { ...((fixture as { server: Record<string, unknown> }).server) };
      // server_type.name becomes top-level server_type_name
      (server as Record<string, unknown>).server_type = "cx22";
      fetchMock.mockResolvedValueOnce(jsonResponse({ server }));

      const result = await adapter.getVmStatus("54321098");

      // Cost lookup fails because server_type is now a string, not {name: string}
      expect(result.monthlyCost).toBeUndefined();
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
      expect(result.keyId).toBe("7654321");
      expect(result.fingerprint).toBe("b7:2f:30:a0:2f:6c:58:6c:21:04:58:61:ba:06:3b:2c");
    });
  });

  describe("listSshKeys", () => {
    it("parses real SSH key list response", async () => {
      const fixture = loadFixture("ssh-key-list.json");
      fetchMock.mockResolvedValueOnce(jsonResponse(fixture));

      const keys = await adapter.listSshKeys();

      expect(keys).toHaveLength(2);
      expect(keys[0].id).toBe("7654321");
      expect(keys[0].name).toBe("clawhq-deploy-key");
      expect(keys[0].fingerprint).toBe("b7:2f:30:a0:2f:6c:58:6c:21:04:58:61:ba:06:3b:2c");
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
        dropletIds: ["54321098"],
      });

      expect(result.success).toBe(true);
      expect(result.firewallId).toBe("12345");
    });

    it("detects firewall.id type change to string UUID", async () => {
      const fixture = loadFixture("firewall-create.json") as Record<string, unknown>;
      const mutated = {
        ...fixture,
        firewall: {
          ...((fixture as { firewall: Record<string, unknown> }).firewall),
          id: "fw-uuid-abc123",
        },
      };
      fetchMock.mockResolvedValueOnce(jsonResponse(mutated));

      const result = await adapter.createFirewall({
        name: "clawhq-test-agent",
        inboundPorts: [443, 18789],
        dropletIds: ["54321098"],
      });

      // String(stringId) still works — code is resilient to this change
      expect(result.success).toBe(true);
      expect(result.firewallId).toBe("fw-uuid-abc123");
    });
  });

  describe("createSnapshot", () => {
    it("parses real image creation response", async () => {
      const fixture = loadFixture("image-create.json");
      fetchMock.mockResolvedValueOnce(jsonResponse(fixture));

      const result = await adapter.createSnapshot({
        providerInstanceId: "54321098",
        name: "clawhq-golden-2026-03-24",
      });

      expect(result.success).toBe(true);
      expect(result.snapshotId).toBe("98765432");
    });
  });

  describe("verifyDestroyed", () => {
    it("returns true for 404 response", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve("not found"),
      } as unknown as Response);

      const result = await adapter.verifyDestroyed("54321098");

      expect(result).toBe(true);
    });

    it("returns false when server still exists", async () => {
      const fixture = loadFixture("server-running.json");
      fetchMock.mockResolvedValueOnce(jsonResponse(fixture));

      const result = await adapter.verifyDestroyed("54321098");

      expect(result).toBe(false);
    });
  });

  describe("getMonthlyCost", () => {
    it("returns cost for server_type in fixture", async () => {
      const fixture = loadFixture("server-running.json") as {
        server: { server_type: { name: string } };
      };
      const cost = adapter.getMonthlyCost(fixture.server.server_type.name);

      expect(cost).toBe(4.51);
    });
  });
});

// ── Live API Tests ──────────────────────────────────────────────────────────

describe("Hetzner live API tests", () => {
  const token = process.env.CLAWHQ_TEST_HETZNER_TOKEN;

  it.skipIf(!token)("validates real token against live API", async () => {
    const adapter = createHetznerAdapter(token as string);
    const result = await adapter.validateToken();

    expect(result.valid).toBe(true);
  });

  it.skipIf(!token)("lists SSH keys from live API", async () => {
    const adapter = createHetznerAdapter(token as string);
    const keys = await adapter.listSshKeys();

    expect(Array.isArray(keys)).toBe(true);
    for (const key of keys) {
      expect(key).toHaveProperty("id");
      expect(key).toHaveProperty("name");
      expect(key).toHaveProperty("fingerprint");
    }
  });
});

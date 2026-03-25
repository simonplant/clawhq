/**
 * Contract tests for the GCP Compute Engine provider adapter.
 *
 * Validates parsing logic against realistic GCE JSON response shapes
 * (sanitized). Catches format changes before production breaks.
 *
 * Live API tests run when CLAWHQ_TEST_GCP_TOKEN is set
 * (format: PROJECT_ID:ACCESS_TOKEN or service account JSON).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createGcpAdapter } from "./gcp.js";

// ── Fixture Loader ──────────────────────────────────────────────────────────

const FIXTURES = join(import.meta.dirname, "__fixtures__", "gcp");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf-8"));
}

// ── Contract Tests (fixture-backed) ─────────────────────────────────────────

describe("GCP contract tests", () => {
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

  // Use PROJECT_ID:ACCESS_TOKEN format to avoid service account JSON parsing
  const adapter = createGcpAdapter("example-project-123:test-access-token-gcp-contract");

  describe("validateToken", () => {
    it("parses real instances list response (empty project)", async () => {
      const fixture = loadFixture("instances-list.json");
      fetchMock.mockResolvedValueOnce(jsonResponse(fixture));

      const result = await adapter.validateToken();

      expect(result.valid).toBe(true);
      expect(result.account).toBe("example-project-123");
    });
  });

  describe("getVmStatus", () => {
    it("parses real running instance response", async () => {
      const fixture = loadFixture("instance-running.json");
      fetchMock.mockResolvedValueOnce(jsonResponse(fixture));

      const result = await adapter.getVmStatus("clawhq-test-agent");

      expect(result.state).toBe("running");
      expect(result.ipAddress).toBe("203.0.113.75");
      expect(result.monthlyCost).toBe(6.11);
    });

    it("extracts machine type from full URL path", async () => {
      const fixture = loadFixture("instance-running.json") as Record<string, unknown>;

      // Verify the fixture has the full URL format that our code must parse
      expect(fixture.machineType).toContain("/machineTypes/e2-micro");

      fetchMock.mockResolvedValueOnce(jsonResponse(fixture));
      const result = await adapter.getVmStatus("clawhq-test-agent");

      expect(result.monthlyCost).toBe(6.11);
    });

    it("detects networkInterfaces structure change", async () => {
      const fixture = loadFixture("instance-running.json") as Record<string, unknown>;
      const mutated = { ...fixture };
      // Simulate GCP flattening accessConfigs into the network interface
      mutated.networkInterfaces = [
        {
          networkIP: "10.128.0.2",
          name: "nic0",
          externalIp: "203.0.113.75",  // Changed from nested accessConfigs
        },
      ];
      fetchMock.mockResolvedValueOnce(jsonResponse(mutated));

      const result = await adapter.getVmStatus("clawhq-test-agent");

      // IP extraction fails because code reads .accessConfigs[0].natIP
      expect(result.ipAddress).toBeUndefined();
    });

    it("detects status field case change", async () => {
      const fixture = loadFixture("instance-running.json") as Record<string, unknown>;
      const mutated = { ...fixture, status: "running" }; // lowercase instead of "RUNNING"
      fetchMock.mockResolvedValueOnce(jsonResponse(mutated));

      const result = await adapter.getVmStatus("clawhq-test-agent");

      // Our code does .toLowerCase() so this should still work
      expect(result.state).toBe("running");
    });

    it("handles missing machineType gracefully", async () => {
      const fixture = loadFixture("instance-running.json") as Record<string, unknown>;
      const mutated = { ...fixture };
      delete mutated.machineType;
      fetchMock.mockResolvedValueOnce(jsonResponse(mutated));

      const result = await adapter.getVmStatus("clawhq-test-agent");

      expect(result.state).toBe("running");
      expect(result.monthlyCost).toBeUndefined();
    });
  });

  describe("addSshKey", () => {
    it("parses real project metadata for SSH key management", async () => {
      const projectFixture = loadFixture("project-metadata.json");
      const setMetadataFixture = loadFixture("set-metadata-op.json");

      fetchMock
        .mockResolvedValueOnce(jsonResponse(projectFixture))   // GET /projects/{id}
        .mockResolvedValueOnce(jsonResponse(setMetadataFixture)); // POST setCommonInstanceMetadata

      const result = await adapter.addSshKey({
        name: "clawhq-deploy",
        publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINewKeyHere clawhq@deploy",
      });

      expect(result.success).toBe(true);
      expect(result.keyId).toBe("clawhq-deploy");
    });

    it("detects commonInstanceMetadata structure change", async () => {
      // Simulate format change: metadata is at a different path
      const fixture = loadFixture("project-metadata.json") as Record<string, unknown>;
      const mutated = { ...fixture };
      (mutated as Record<string, unknown>).instanceMetadata = (mutated as Record<string, unknown>).commonInstanceMetadata;
      delete (mutated as Record<string, unknown>).commonInstanceMetadata;
      const setMetadataFixture = loadFixture("set-metadata-op.json");

      fetchMock
        .mockResolvedValueOnce(jsonResponse(mutated))            // GET /projects/{id}
        .mockResolvedValueOnce(jsonResponse(setMetadataFixture)); // POST setCommonInstanceMetadata

      const result = await adapter.addSshKey({
        name: "clawhq-deploy",
        publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINewKeyHere",
      });

      // Code reads .commonInstanceMetadata which is now undefined
      // It should still succeed (empty items) but won't include existing keys
      expect(result.success).toBe(true);
    });
  });

  describe("listSshKeys", () => {
    it("parses SSH keys from project metadata", async () => {
      const fixture = loadFixture("project-metadata.json");
      fetchMock.mockResolvedValueOnce(jsonResponse(fixture));

      const keys = await adapter.listSshKeys();

      expect(keys).toHaveLength(1);
      expect(keys[0].name).toBe("admin");
      expect(keys[0].publicKey).toContain("ssh-ed25519");
    });
  });

  describe("createFirewall", () => {
    it("parses real firewall creation operation response", async () => {
      const createOpFixture = loadFixture("global-operation-done.json");
      // First call: POST firewall → returns operation
      // Second call: GET operation → returns DONE (but our fixture is already DONE)
      fetchMock
        .mockResolvedValueOnce(jsonResponse(createOpFixture))  // POST /global/firewalls
        .mockResolvedValueOnce(jsonResponse(createOpFixture)); // GET /global/operations/{name}

      const result = await adapter.createFirewall({
        name: "clawhq-test-agent",
        inboundPorts: [443, 18789],
        dropletIds: ["clawhq-test-agent"],
      });

      expect(result.success).toBe(true);
      expect(result.firewallId).toBe("clawhq-test-agent");
    });
  });

  describe("createSnapshot", () => {
    it("parses real machine image creation operation", async () => {
      const opFixture = loadFixture("global-operation-done.json");
      fetchMock
        .mockResolvedValueOnce(jsonResponse(opFixture))  // POST /global/machineImages
        .mockResolvedValueOnce(jsonResponse(opFixture)); // GET /global/operations/{name}

      const result = await adapter.createSnapshot({
        providerInstanceId: "clawhq-test-agent",
        name: "clawhq-golden-2026-03-24",
      });

      expect(result.success).toBe(true);
      expect(result.snapshotId).toBe("clawhq-golden-2026-03-24");
    });
  });

  describe("destroyVm", () => {
    it("parses real delete operation response", async () => {
      const opFixture = loadFixture("operation-done.json");
      fetchMock
        .mockResolvedValueOnce(jsonResponse(opFixture))  // DELETE /instances/{name}
        .mockResolvedValueOnce(jsonResponse(opFixture)); // GET /operations/{name}

      const result = await adapter.destroyVm("clawhq-test-agent");

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

      const result = await adapter.verifyDestroyed("clawhq-test-agent");

      expect(result).toBe(true);
    });

    it("returns false when instance still exists", async () => {
      const fixture = loadFixture("instance-running.json");
      fetchMock.mockResolvedValueOnce(jsonResponse(fixture));

      const result = await adapter.verifyDestroyed("clawhq-test-agent");

      expect(result).toBe(false);
    });
  });

  describe("getMonthlyCost", () => {
    it("returns cost for machine type in fixture", () => {
      const cost = adapter.getMonthlyCost("e2-micro");
      expect(cost).toBe(6.11);
    });
  });
});

// ── Live API Tests ──────────────────────────────────────────────────────────

describe("GCP live API tests", () => {
  const token = process.env.CLAWHQ_TEST_GCP_TOKEN;

  it.skipIf(!token)("validates real credentials against live API", async () => {
    const adapter = createGcpAdapter(token!);
    const result = await adapter.validateToken();

    expect(result.valid).toBe(true);
    expect(result.account).toBeTruthy();
  });

  it.skipIf(!token)("lists SSH keys from live API", async () => {
    const adapter = createGcpAdapter(token!);
    const keys = await adapter.listSshKeys();

    expect(Array.isArray(keys)).toBe(true);
    for (const key of keys) {
      expect(key).toHaveProperty("id");
      expect(key).toHaveProperty("name");
    }
  });
});

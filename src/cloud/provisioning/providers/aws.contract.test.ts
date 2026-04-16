/**
 * Contract tests for the AWS EC2 provider adapter.
 *
 * Validates parsing logic against realistic EC2 XML response shapes
 * (sanitized). AWS responses are XML, so fixtures are .xml files read as text.
 *
 * Live API tests run when CLAWHQ_TEST_AWS_TOKEN is set (format: ACCESS_KEY_ID:SECRET_ACCESS_KEY).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAwsAdapter } from "./aws.js";

// ── Fixture Loader ──────────────────────────────────────────────────────────

const FIXTURES = join(import.meta.dirname, "__fixtures__", "aws");

function loadXmlFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf-8");
}

// ── Contract Tests (fixture-backed) ─────────────────────────────────────────

describe("AWS contract tests", () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;

  beforeEach(() => {
    fetchMock = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function xmlResponse(xml: string, status = 200): Response {
    return new Response(xml, { status });
  }

  const adapter = createAwsAdapter("AKIAIOSFODNN7EXAMPLE:wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");

  describe("validateToken", () => {
    it("parses real DescribeRegions response", async () => {
      const xml = loadXmlFixture("describe-regions.xml");
      fetchMock.mockResolvedValueOnce(xmlResponse(xml));

      const result = await adapter.validateToken();

      expect(result.valid).toBe(true);
      expect(result.account).toBe("AKIAIOSF...");
    });
  });

  describe("getVmStatus", () => {
    it("parses real DescribeInstances running response", async () => {
      const xml = loadXmlFixture("describe-instances-running.xml");
      fetchMock.mockResolvedValueOnce(xmlResponse(xml));

      const result = await adapter.getVmStatus("i-0a1b2c3d4e5f67890");

      expect(result.state).toBe("running");
      // The XML has both <publicIp> (in association) and <ipAddress>
      expect(result.ipAddress).toBeTruthy();
      expect(result.monthlyCost).toBe(7.59);
    });

    it("extracts instanceType for cost lookup", async () => {
      const xml = loadXmlFixture("describe-instances-running.xml");
      fetchMock.mockResolvedValueOnce(xmlResponse(xml));

      const result = await adapter.getVmStatus("i-0a1b2c3d4e5f67890");

      // t3.micro should map to $7.59/mo
      expect(result.monthlyCost).toBe(7.59);
    });

    it("detects state tag rename", async () => {
      // Simulate XML format change: <name> inside instanceState renamed to <stateName>
      const xml = loadXmlFixture("describe-instances-running.xml")
        .replace(/<instanceState>\s*<code>16<\/code>\s*<name>running<\/name>\s*<\/instanceState>/,
          "<instanceState><code>16</code><stateName>running</stateName></instanceState>");
      fetchMock.mockResolvedValueOnce(xmlResponse(xml));

      const result = await adapter.getVmStatus("i-0a1b2c3d4e5f67890");

      // extractXmlValue looks for <name>, which is now absent in instanceState
      // But it might pick up another <name> tag — the point is the state won't be "running"
      // because the first <name> found may be different
      expect(result.state).not.toBe("running");
    });
  });

  describe("addSshKey", () => {
    it("parses real ImportKeyPair response", async () => {
      const xml = loadXmlFixture("import-key-pair.xml");
      fetchMock.mockResolvedValueOnce(xmlResponse(xml));

      const result = await adapter.addSshKey({
        name: "clawhq-deploy-key",
        publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyDataHere",
      });

      expect(result.success).toBe(true);
      expect(result.keyId).toBe("clawhq-deploy-key");
      expect(result.fingerprint).toBe("1f:51:ae:28:bf:89:e9:d8:1f:25:5d:37:2d:7d:b8:ca:9f:f5:f1:6f");
    });
  });

  describe("listSshKeys", () => {
    it("parses real DescribeKeyPairs response", async () => {
      const xml = loadXmlFixture("describe-key-pairs.xml");
      fetchMock.mockResolvedValueOnce(xmlResponse(xml));

      const keys = await adapter.listSshKeys();

      expect(keys).toHaveLength(2);
      expect(keys[0].name).toBe("clawhq-deploy-key");
      expect(keys[0].fingerprint).toBe("1f:51:ae:28:bf:89:e9:d8:1f:25:5d:37:2d:7d:b8:ca:9f:f5:f1:6f");
      expect(keys[1].name).toBe("personal-laptop");
    });
  });

  describe("createFirewall", () => {
    it("parses real CreateSecurityGroup + AuthorizeIngress response", async () => {
      const sgXml = loadXmlFixture("create-security-group.xml");
      const authXml = loadXmlFixture("authorize-security-group.xml");

      fetchMock
        .mockResolvedValueOnce(xmlResponse(sgXml))
        .mockResolvedValueOnce(xmlResponse(authXml))
        .mockResolvedValueOnce(xmlResponse(authXml));

      const result = await adapter.createFirewall({
        name: "clawhq-test-agent",
        inboundPorts: [443, 18789],
        dropletIds: ["i-0a1b2c3d4e5f67890"],
      });

      expect(result.success).toBe(true);
      expect(result.firewallId).toBe("sg-0abcdef1234567890");
    });

    it("detects groupId field rename", async () => {
      // Simulate XML change: <groupId> renamed to <securityGroupId>
      const sgXml = loadXmlFixture("create-security-group.xml")
        .replace(/<groupId>sg-0abcdef1234567890<\/groupId>/, "<securityGroupId>sg-0abcdef1234567890</securityGroupId>");
      fetchMock.mockResolvedValueOnce(xmlResponse(sgXml));

      const result = await adapter.createFirewall({
        name: "clawhq-test-agent",
        inboundPorts: [443],
        dropletIds: ["i-test"],
      });

      // extractXmlValue("groupId") returns undefined → error
      expect(result.success).toBe(false);
    });
  });

  describe("createSnapshot", () => {
    it("parses real CreateImage response", async () => {
      const xml = loadXmlFixture("create-image.xml");
      fetchMock.mockResolvedValueOnce(xmlResponse(xml));

      const result = await adapter.createSnapshot({
        providerInstanceId: "i-0a1b2c3d4e5f67890",
        name: "clawhq-golden-2026-03-24",
      });

      expect(result.success).toBe(true);
      expect(result.snapshotId).toBe("ami-0fedcba9876543210");
    });
  });

  describe("destroyVm", () => {
    it("parses real TerminateInstances response", async () => {
      const xml = loadXmlFixture("terminate-instances.xml");
      fetchMock.mockResolvedValueOnce(xmlResponse(xml));

      const result = await adapter.destroyVm("i-0a1b2c3d4e5f67890");

      expect(result.success).toBe(true);
      expect(result.destroyed).toBe(true);
    });
  });

  describe("verifyDestroyed", () => {
    it("returns true for terminated state", async () => {
      const xml = loadXmlFixture("describe-instances-terminated.xml");
      fetchMock.mockResolvedValueOnce(xmlResponse(xml));

      const result = await adapter.verifyDestroyed("i-0a1b2c3d4e5f67890");

      expect(result).toBe(true);
    });

    it("returns false for running state", async () => {
      const xml = loadXmlFixture("describe-instances-running.xml");
      fetchMock.mockResolvedValueOnce(xmlResponse(xml));

      const result = await adapter.verifyDestroyed("i-0a1b2c3d4e5f67890");

      expect(result).toBe(false);
    });
  });

  describe("getMonthlyCost", () => {
    it("returns cost for instance type in fixture", () => {
      const cost = adapter.getMonthlyCost("t3.micro");
      expect(cost).toBe(7.59);
    });
  });
});

// ── Live API Tests ──────────────────────────────────────────────────────────

describe("AWS live API tests", () => {
  const token = process.env.CLAWHQ_TEST_AWS_TOKEN;

  it.skipIf(!token)("validates real credentials against live API", async () => {
    const adapter = createAwsAdapter(token as string);
    const result = await adapter.validateToken();

    expect(result.valid).toBe(true);
    expect(result.account).toBeTruthy();
  });

  it.skipIf(!token)("lists SSH key pairs from live API", async () => {
    const adapter = createAwsAdapter(token as string);
    const keys = await adapter.listSshKeys();

    expect(Array.isArray(keys)).toBe(true);
    for (const key of keys) {
      expect(key).toHaveProperty("id");
      expect(key).toHaveProperty("name");
      expect(key).toHaveProperty("fingerprint");
    }
  });
});

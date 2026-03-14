import { mkdir, rm, writeFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  collectEgressAudit,
  parseDropLog,
  parseEgressLog,
} from "./egress.js";
import type { EgressAuditReport } from "./egress.js";
import {
  formatEgressAuditJson,
  formatEgressAuditTable,
  generateExportReport,
  generateZeroEgressAttestation,
} from "./format.js";

const TEST_DIR = "/tmp/clawhq-audit-egress-test";
const LOG_PATH = `${TEST_DIR}/egress.log`;

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

// --- parseEgressLog ---

describe("parseEgressLog", () => {
  it("returns empty array for missing file", async () => {
    const entries = await parseEgressLog("/tmp/nonexistent/egress.log");
    expect(entries).toEqual([]);
  });

  it("returns empty array for empty file", async () => {
    await writeFile(LOG_PATH, "");
    const entries = await parseEgressLog(LOG_PATH);
    expect(entries).toEqual([]);
  });

  it("parses valid JSON lines", async () => {
    const now = new Date().toISOString();
    const lines = [
      JSON.stringify({ timestamp: now, provider: "anthropic", bytesOut: 1024, model: "sonnet", tokenCountIn: 100, tokenCountOut: 50, dataCategory: "research", cost: 0.01 }),
      JSON.stringify({ timestamp: now, provider: "openai", bytesOut: 2048 }),
    ];
    await writeFile(LOG_PATH, lines.join("\n") + "\n");

    const entries = await parseEgressLog(LOG_PATH);
    expect(entries).toHaveLength(2);
    expect(entries[0].provider).toBe("anthropic");
    expect(entries[0].model).toBe("sonnet");
    expect(entries[0].tokenCountIn).toBe(100);
    expect(entries[0].tokenCountOut).toBe(50);
    expect(entries[0].dataCategory).toBe("research");
    expect(entries[0].cost).toBe(0.01);
    expect(entries[0].bytesOut).toBe(1024);
    expect(entries[1].provider).toBe("openai");
    expect(entries[1].model).toBeUndefined();
    expect(entries[1].bytesOut).toBe(2048);
  });

  it("handles snake_case field names", async () => {
    const now = new Date().toISOString();
    const line = JSON.stringify({
      timestamp: now,
      provider: "google",
      bytes_out: 512,
      token_count_in: 200,
      token_count_out: 80,
      data_category: "email",
    });
    await writeFile(LOG_PATH, line + "\n");

    const entries = await parseEgressLog(LOG_PATH);
    expect(entries).toHaveLength(1);
    expect(entries[0].bytesOut).toBe(512);
    expect(entries[0].tokenCountIn).toBe(200);
    expect(entries[0].tokenCountOut).toBe(80);
    expect(entries[0].dataCategory).toBe("email");
  });

  it("skips malformed lines", async () => {
    const now = new Date().toISOString();
    const lines = [
      "not json",
      JSON.stringify({ timestamp: now, provider: "anthropic", bytesOut: 100 }),
      "{broken",
    ];
    await writeFile(LOG_PATH, lines.join("\n") + "\n");

    const entries = await parseEgressLog(LOG_PATH);
    expect(entries).toHaveLength(1);
    expect(entries[0].bytesOut).toBe(100);
  });
});

// --- parseDropLog ---

describe("parseDropLog", () => {
  it("returns empty array for empty input", () => {
    expect(parseDropLog("")).toEqual([]);
  });

  it("returns empty array when no CLAWHQ_DROP lines", () => {
    const dmesg = "[ 1234.567] some other kernel message\n[ 1235.000] another message\n";
    expect(parseDropLog(dmesg)).toEqual([]);
  });

  it("parses CLAWHQ_DROP lines with kernel timestamps", () => {
    const dmesg = [
      "[ 1234.567890] CLAWHQ_DROP: IN=docker0 OUT=eth0 SRC=172.17.0.2 DST=93.184.216.34 LEN=60 PROTO=TCP DPT=443",
      "[ 1235.000000] CLAWHQ_DROP: IN=docker0 OUT=eth0 SRC=172.17.0.2 DST=104.16.0.1 LEN=52 PROTO=UDP DPT=8080",
    ].join("\n");

    const drops = parseDropLog(dmesg);
    expect(drops).toHaveLength(2);
    expect(drops[0].srcIp).toBe("172.17.0.2");
    expect(drops[0].dstIp).toBe("93.184.216.34");
    expect(drops[0].dstPort).toBe(443);
    expect(drops[0].protocol).toBe("TCP");
    expect(drops[1].dstPort).toBe(8080);
    expect(drops[1].protocol).toBe("UDP");
  });

  it("parses ISO timestamp format", () => {
    const dmesg = "2026-03-13T10:30:00+00:00 CLAWHQ_DROP: IN=docker0 OUT=eth0 SRC=172.17.0.2 DST=1.2.3.4 PROTO=TCP DPT=443\n";
    const drops = parseDropLog(dmesg);
    expect(drops).toHaveLength(1);
    expect(drops[0].timestamp).toBe("2026-03-13T10:30:00+00:00");
  });

  it("ignores non-drop kernel messages", () => {
    const dmesg = [
      "[ 100.000] some random message",
      "[ 200.000] CLAWHQ_DROP: IN=docker0 SRC=172.17.0.2 DST=8.8.8.8 PROTO=TCP DPT=80",
      "[ 300.000] another random message",
    ].join("\n");

    const drops = parseDropLog(dmesg);
    expect(drops).toHaveLength(1);
  });
});

// --- collectEgressAudit ---

describe("collectEgressAudit", () => {
  it("returns zero-egress report for missing log", async () => {
    const report = await collectEgressAudit({
      egressLogPath: "/tmp/nonexistent/egress.log",
      includeDrops: false,
    });

    expect(report.summary.zeroEgress).toBe(true);
    expect(report.summary.totalCalls).toBe(0);
    expect(report.summary.totalBytesOut).toBe(0);
    expect(report.entries).toEqual([]);
  });

  it("collects entries from egress log", async () => {
    const now = new Date().toISOString();
    const lines = [
      JSON.stringify({ timestamp: now, provider: "anthropic", bytesOut: 1024, cost: 0.05 }),
      JSON.stringify({ timestamp: now, provider: "anthropic", bytesOut: 512, cost: 0.02 }),
      JSON.stringify({ timestamp: now, provider: "openai", bytesOut: 2048, cost: 0.10 }),
    ];
    await writeFile(LOG_PATH, lines.join("\n") + "\n");

    const report = await collectEgressAudit({
      egressLogPath: LOG_PATH,
      includeDrops: false,
    });

    expect(report.summary.zeroEgress).toBe(false);
    expect(report.summary.totalCalls).toBe(3);
    expect(report.summary.totalBytesOut).toBe(3584);
    expect(report.summary.totalCost).toBeCloseTo(0.17);
    expect(report.summary.byProvider.anthropic.calls).toBe(2);
    expect(report.summary.byProvider.openai.calls).toBe(1);
  });

  it("filters entries by since parameter", async () => {
    const old = new Date("2025-01-01T00:00:00Z").toISOString();
    const recent = new Date().toISOString();
    const lines = [
      JSON.stringify({ timestamp: old, provider: "anthropic", bytesOut: 1000 }),
      JSON.stringify({ timestamp: recent, provider: "openai", bytesOut: 2000 }),
    ];
    await writeFile(LOG_PATH, lines.join("\n") + "\n");

    const report = await collectEgressAudit({
      egressLogPath: LOG_PATH,
      since: "2026-01-01T00:00:00Z",
      includeDrops: false,
    });

    expect(report.summary.totalCalls).toBe(1);
    expect(report.entries[0].provider).toBe("openai");
  });

  it("aggregates provider summary correctly", async () => {
    const now = new Date().toISOString();
    const lines = [
      JSON.stringify({ timestamp: now, provider: "anthropic", bytesOut: 100, tokenCountIn: 50, tokenCountOut: 25 }),
      JSON.stringify({ timestamp: now, provider: "anthropic", bytesOut: 200, tokenCountIn: 100, tokenCountOut: 50 }),
    ];
    await writeFile(LOG_PATH, lines.join("\n") + "\n");

    const report = await collectEgressAudit({
      egressLogPath: LOG_PATH,
      includeDrops: false,
    });

    const anthropic = report.summary.byProvider.anthropic;
    expect(anthropic.calls).toBe(2);
    expect(anthropic.bytesOut).toBe(300);
    expect(anthropic.tokensIn).toBe(150);
    expect(anthropic.tokensOut).toBe(75);
  });
});

// --- formatEgressAuditTable ---

describe("formatEgressAuditTable", () => {
  it("shows zero-egress badge when no calls", () => {
    const report: EgressAuditReport = {
      since: null,
      until: new Date().toISOString(),
      entries: [],
      drops: [],
      summary: {
        totalCalls: 0,
        totalBytesOut: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalCost: 0,
        totalDrops: 0,
        byProvider: {},
        zeroEgress: true,
      },
    };

    const output = formatEgressAuditTable(report);
    expect(output).toContain("EGRESS AUDIT");
    expect(output).toContain("ZERO EGRESS");
    expect(output).toContain("0 calls, 0 blocked packets");
  });

  it("shows provider summary table", () => {
    const report: EgressAuditReport = {
      since: null,
      until: "2026-03-13T12:00:00Z",
      entries: [
        { timestamp: "2026-03-13T10:00:00Z", provider: "anthropic", bytesOut: 1024, model: "sonnet", cost: 0.05 },
      ],
      drops: [],
      summary: {
        totalCalls: 1,
        totalBytesOut: 1024,
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalCost: 0.05,
        totalDrops: 0,
        byProvider: {
          anthropic: { calls: 1, bytesOut: 1024, tokensIn: 0, tokensOut: 0, cost: 0.05 },
        },
        zeroEgress: false,
      },
    };

    const output = formatEgressAuditTable(report);
    expect(output).toContain("anthropic");
    expect(output).toContain("CALL LOG");
    expect(output).toContain("sonnet");
    expect(output).toContain("1 call, 0 blocked packets");
  });

  it("shows blocked packets section", () => {
    const report: EgressAuditReport = {
      since: null,
      until: "2026-03-13T12:00:00Z",
      entries: [],
      drops: [
        { timestamp: "kernel+1234.5s", srcIp: "172.17.0.2", dstIp: "93.184.216.34", dstPort: 443, protocol: "TCP" },
      ],
      summary: {
        totalCalls: 0,
        totalBytesOut: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalCost: 0,
        totalDrops: 1,
        byProvider: {},
        zeroEgress: true,
      },
    };

    const output = formatEgressAuditTable(report);
    expect(output).toContain("BLOCKED PACKETS");
    expect(output).toContain("172.17.0.2");
    expect(output).toContain("93.184.216.34");
  });
});

// --- formatEgressAuditJson ---

describe("formatEgressAuditJson", () => {
  it("produces valid JSON", () => {
    const report: EgressAuditReport = {
      since: null,
      until: "2026-03-13T12:00:00Z",
      entries: [],
      drops: [],
      summary: {
        totalCalls: 0,
        totalBytesOut: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalCost: 0,
        totalDrops: 0,
        byProvider: {},
        zeroEgress: true,
      },
    };

    const json = formatEgressAuditJson(report);
    const parsed = JSON.parse(json);
    expect(parsed.summary.zeroEgress).toBe(true);
  });
});

// --- generateExportReport ---

describe("generateExportReport", () => {
  it("includes SHA-256 digest", () => {
    const report: EgressAuditReport = {
      since: null,
      until: "2026-03-13T12:00:00Z",
      entries: [],
      drops: [],
      summary: {
        totalCalls: 0,
        totalBytesOut: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalCost: 0,
        totalDrops: 0,
        byProvider: {},
        zeroEgress: true,
      },
    };

    const output = generateExportReport(report);
    expect(output).toContain("CLAWHQ EGRESS AUDIT REPORT");
    expect(output).toContain("SHA-256:");
    expect(output).toMatch(/SHA-256: [0-9a-f]{64}/);
  });

  it("includes provider breakdown", () => {
    const report: EgressAuditReport = {
      since: "2026-03-01T00:00:00Z",
      until: "2026-03-13T12:00:00Z",
      entries: [
        { timestamp: "2026-03-10T10:00:00Z", provider: "anthropic", bytesOut: 512, cost: 0.03 },
      ],
      drops: [],
      summary: {
        totalCalls: 1,
        totalBytesOut: 512,
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalCost: 0.03,
        totalDrops: 0,
        byProvider: {
          anthropic: { calls: 1, bytesOut: 512, tokensIn: 0, tokensOut: 0, cost: 0.03 },
        },
        zeroEgress: false,
      },
    };

    const output = generateExportReport(report);
    expect(output).toContain("anthropic: 1 calls");
    expect(output).toContain("Zero egress:          NO");
  });
});

// --- generateZeroEgressAttestation ---

describe("generateZeroEgressAttestation", () => {
  it("returns attestation when zero egress", () => {
    const report: EgressAuditReport = {
      since: "2026-03-01T00:00:00Z",
      until: "2026-03-13T12:00:00Z",
      entries: [],
      drops: [],
      summary: {
        totalCalls: 0,
        totalBytesOut: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalCost: 0,
        totalDrops: 0,
        byProvider: {},
        zeroEgress: true,
      },
    };

    const attestation = generateZeroEgressAttestation(report);
    expect(attestation).not.toBeNull();
    expect(attestation).toContain("ZERO-EGRESS ATTESTATION");
    expect(attestation).toContain("No data was sent to any cloud provider");
    expect(attestation).toMatch(/SHA-256: [0-9a-f]{64}/);
  });

  it("returns null when egress exists", () => {
    const report: EgressAuditReport = {
      since: null,
      until: "2026-03-13T12:00:00Z",
      entries: [
        { timestamp: "2026-03-10T10:00:00Z", provider: "anthropic", bytesOut: 512 },
      ],
      drops: [],
      summary: {
        totalCalls: 1,
        totalBytesOut: 512,
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalCost: 0,
        totalDrops: 0,
        byProvider: {
          anthropic: { calls: 1, bytesOut: 512, tokensIn: 0, tokensOut: 0, cost: 0 },
        },
        zeroEgress: false,
      },
    };

    const attestation = generateZeroEgressAttestation(report);
    expect(attestation).toBeNull();
  });

  it("includes blocked packet count", () => {
    const report: EgressAuditReport = {
      since: null,
      until: "2026-03-13T12:00:00Z",
      entries: [],
      drops: [
        { timestamp: "kernel+100s", srcIp: "172.17.0.2", dstIp: "1.2.3.4", dstPort: 443, protocol: "TCP" },
      ],
      summary: {
        totalCalls: 0,
        totalBytesOut: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalCost: 0,
        totalDrops: 1,
        byProvider: {},
        zeroEgress: true,
      },
    };

    const attestation = generateZeroEgressAttestation(report);
    expect(attestation).toContain("Blocked packets:  1");
  });
});

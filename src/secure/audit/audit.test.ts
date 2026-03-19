import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createAuditConfig,
  initHmacChain,
  initSeqCounter,
  logEgressEvent,
  logSecretEvent,
  logToolExecution,
} from "./logger.js";
import { readAuditReport, verifyHmacChain } from "./reader.js";
import { buildOwaspExport } from "./owasp.js";
import { formatAuditJson, formatAuditTable } from "./format.js";
import type { AuditTrailConfig, SecretLifecycleEvent } from "./types.js";

// ── Test Fixtures ──────────────────────────────────────────────────────────

let testDir: string;
let config: AuditTrailConfig;
const HMAC_KEY = "test-hmac-key-for-audit-trail";

beforeEach(async () => {
  testDir = join(tmpdir(), `clawhq-audit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(testDir, "ops", "audit"), { recursive: true });
  config = createAuditConfig(testDir, HMAC_KEY);
  // Reset module-level state (seq counters + HMAC chain) for test isolation
  await initSeqCounter(config.toolLogPath);
  await initSeqCounter(config.egressLogPath);
  await initSeqCounter(config.secretLogPath);
  await initHmacChain(config.secretLogPath);
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// ── Tool Execution Logging ─────────────────────────────────────────────────

describe("logToolExecution", () => {
  it("appends a tool execution event to JSONL", async () => {
    await logToolExecution(config, {
      tool: "email",
      action: "check inbox",
      status: "success",
      durationMs: 150,
    });

    const content = readFileSync(config.toolLogPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);

    const event = JSON.parse(lines[0]);
    expect(event.type).toBe("tool_execution");
    expect(event.tool).toBe("email");
    expect(event.action).toBe("check inbox");
    expect(event.status).toBe("success");
    expect(event.durationMs).toBe(150);
    expect(event.seq).toBe(1);
    expect(event.ts).toBeDefined();
  });

  it("appends multiple events with incrementing seq", async () => {
    await logToolExecution(config, {
      tool: "email",
      action: "check",
      status: "success",
      durationMs: 100,
    });
    await logToolExecution(config, {
      tool: "calendar",
      action: "list events",
      status: "failure",
      durationMs: 200,
      error: "API timeout",
    });

    const content = readFileSync(config.toolLogPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);

    const event1 = JSON.parse(lines[0]);
    const event2 = JSON.parse(lines[1]);
    expect(event1.seq).toBe(1);
    expect(event2.seq).toBe(2);
    expect(event2.error).toBe("API timeout");
  });

  it("truncates long action strings", async () => {
    const longAction = "x".repeat(300);
    await logToolExecution(config, {
      tool: "test",
      action: longAction,
      status: "success",
      durationMs: 10,
    });

    const content = readFileSync(config.toolLogPath, "utf-8");
    const event = JSON.parse(content.trim());
    expect(event.action.length).toBe(200);
  });
});

// ── Egress Logging ─────────────────────────────────────────────────────────

describe("logEgressEvent", () => {
  it("appends an egress event to JSONL", async () => {
    await logEgressEvent(config, {
      destination: "api.openai.com",
      protocol: "https",
      bytesSent: 1024,
      integration: "openai",
      allowed: true,
    });

    const content = readFileSync(config.egressLogPath, "utf-8");
    const event = JSON.parse(content.trim());
    expect(event.type).toBe("egress");
    expect(event.destination).toBe("api.openai.com");
    expect(event.allowed).toBe(true);
  });
});

// ── Secret Lifecycle (HMAC-chained) ────────────────────────────────────────

describe("logSecretEvent", () => {
  it("creates HMAC-chained secret events", async () => {
    await logSecretEvent(config, {
      secretId: "OPENAI_API_KEY",
      action: "added",
      actor: "clawhq init",
    });
    await logSecretEvent(config, {
      secretId: "OPENAI_API_KEY",
      action: "rotated",
      actor: "clawhq creds",
    });

    const content = readFileSync(config.secretLogPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);

    const event1 = JSON.parse(lines[0]) as SecretLifecycleEvent;
    const event2 = JSON.parse(lines[1]) as SecretLifecycleEvent;

    // First event chains from empty
    expect(event1.prevHmac).toBe("");
    expect(event1.hmac).toBeTruthy();

    // Second event chains from first
    expect(event2.prevHmac).toBe(event1.hmac);
    expect(event2.hmac).toBeTruthy();
    expect(event2.hmac).not.toBe(event1.hmac);
  });
});

// ── HMAC Chain Verification ────────────────────────────────────────────────

describe("verifyHmacChain", () => {
  it("verifies a valid chain", async () => {
    await logSecretEvent(config, {
      secretId: "KEY_A",
      action: "added",
      actor: "test",
    });
    await logSecretEvent(config, {
      secretId: "KEY_B",
      action: "added",
      actor: "test",
    });

    const content = readFileSync(config.secretLogPath, "utf-8");
    const events = content
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as SecretLifecycleEvent);

    expect(verifyHmacChain(events, HMAC_KEY)).toBe(true);
  });

  it("detects tampering", async () => {
    await logSecretEvent(config, {
      secretId: "KEY_A",
      action: "added",
      actor: "test",
    });
    await logSecretEvent(config, {
      secretId: "KEY_B",
      action: "added",
      actor: "test",
    });

    const content = readFileSync(config.secretLogPath, "utf-8");
    const events = content
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as SecretLifecycleEvent);

    // Tamper with the first event
    const tampered = [{ ...events[0], actor: "evil" }, events[1]];
    expect(verifyHmacChain(tampered, HMAC_KEY)).toBe(false);
  });

  it("returns true for empty chain", () => {
    expect(verifyHmacChain([], HMAC_KEY)).toBe(true);
  });
});

// ── Audit Report Reader ────────────────────────────────────────────────────

describe("readAuditReport", () => {
  it("reads all three streams into a unified report", async () => {
    await logToolExecution(config, {
      tool: "email",
      action: "check",
      status: "success",
      durationMs: 100,
    });
    await logEgressEvent(config, {
      destination: "smtp.gmail.com",
      protocol: "smtp",
      bytesSent: 512,
      integration: "email",
      allowed: true,
    });
    await logSecretEvent(config, {
      secretId: "SMTP_PASSWORD",
      action: "accessed",
      actor: "email-tool",
    });

    const report = await readAuditReport(config);

    expect(report.toolExecutions).toHaveLength(1);
    expect(report.egressEvents).toHaveLength(1);
    expect(report.secretEvents).toHaveLength(1);
    expect(report.summary.totalToolExecutions).toBe(1);
    expect(report.summary.allowedEgress).toBe(1);
    expect(report.summary.chainValid).toBe(true);
  });

  it("returns empty report when no logs exist", async () => {
    const emptyConfig = createAuditConfig(join(testDir, "nonexistent"), HMAC_KEY);
    const report = await readAuditReport(emptyConfig);

    expect(report.toolExecutions).toHaveLength(0);
    expect(report.egressEvents).toHaveLength(0);
    expect(report.secretEvents).toHaveLength(0);
    expect(report.summary.chainValid).toBe(true);
  });

  it("filters by since timestamp", async () => {
    // Write an event with a known past timestamp
    const pastEvent = JSON.stringify({
      type: "tool_execution",
      ts: "2020-01-01T00:00:00.000Z",
      seq: 1,
      tool: "old",
      action: "old action",
      status: "success",
      durationMs: 10,
    });
    writeFileSync(config.toolLogPath, pastEvent + "\n");

    await initSeqCounter(config.toolLogPath);
    await logToolExecution(config, {
      tool: "new",
      action: "new action",
      status: "success",
      durationMs: 20,
    });

    const report = await readAuditReport(config, {
      since: "2025-01-01T00:00:00.000Z",
    });

    expect(report.toolExecutions).toHaveLength(1);
    expect(report.toolExecutions[0].tool).toBe("new");
  });

  it("limits events per stream", async () => {
    for (let i = 0; i < 5; i++) {
      await logToolExecution(config, {
        tool: `tool-${i}`,
        action: `action-${i}`,
        status: "success",
        durationMs: i * 10,
      });
    }

    const report = await readAuditReport(config, { limit: 2 });
    expect(report.toolExecutions).toHaveLength(2);
    // Should be the most recent
    expect(report.toolExecutions[0].tool).toBe("tool-3");
    expect(report.toolExecutions[1].tool).toBe("tool-4");
  });
});

// ── OWASP Export ───────────────────────────────────────────────────────────

describe("buildOwaspExport", () => {
  it("produces OWASP-compatible export", async () => {
    await logToolExecution(config, {
      tool: "email",
      action: "send",
      status: "success",
      durationMs: 200,
    });
    await logEgressEvent(config, {
      destination: "smtp.gmail.com",
      protocol: "smtp",
      bytesSent: 1024,
      integration: "email",
      allowed: true,
    });
    await logSecretEvent(config, {
      secretId: "SMTP_PASS",
      action: "accessed",
      actor: "email-tool",
    });

    const report = await readAuditReport(config);
    const exported = buildOwaspExport(report, testDir);

    expect(exported.version).toBe("1.0");
    expect(exported.generator).toBe("clawhq");
    expect(exported.events).toHaveLength(3);

    const categories = exported.events.map((e) => e.category);
    expect(categories).toContain("tool-execution");
    expect(categories).toContain("data-egress");
    expect(categories).toContain("secret-lifecycle");

    // Events sorted by timestamp
    for (let i = 1; i < exported.events.length; i++) {
      expect(exported.events[i].timestamp >= exported.events[i - 1].timestamp).toBe(true);
    }
  });
});

// ── Formatters ─────────────────────────────────────────────────────────────

describe("formatAuditTable", () => {
  it("formats an audit report as a readable table", async () => {
    await logToolExecution(config, {
      tool: "email",
      action: "check inbox",
      status: "success",
      durationMs: 150,
    });

    const report = await readAuditReport(config);
    const output = formatAuditTable(report);

    expect(output).toContain("Tool Executions");
    expect(output).toContain("email");
    expect(output).toContain("✔ ok");
    expect(output).toContain("Summary");
  });

  it("shows empty state messages", async () => {
    const report = await readAuditReport(config);
    const output = formatAuditTable(report);

    expect(output).toContain("No tool executions recorded");
    expect(output).toContain("No egress events recorded");
    expect(output).toContain("No secret lifecycle events recorded");
  });
});

describe("formatAuditJson", () => {
  it("formats an audit report as valid JSON", async () => {
    await logToolExecution(config, {
      tool: "test",
      action: "test",
      status: "success",
      durationMs: 10,
    });

    const report = await readAuditReport(config);
    const output = formatAuditJson(report);
    const parsed = JSON.parse(output);

    expect(parsed.toolExecutions).toHaveLength(1);
    expect(parsed.summary).toBeDefined();
  });
});

// ── HMAC Chain Init ────────────────────────────────────────────────────────

describe("initHmacChain", () => {
  it("resumes chain from existing log", async () => {
    await logSecretEvent(config, {
      secretId: "KEY_A",
      action: "added",
      actor: "test",
    });

    const content = readFileSync(config.secretLogPath, "utf-8");
    const firstEvent = JSON.parse(content.trim()) as SecretLifecycleEvent;

    // Simulate process restart — reinitialize chain
    await initHmacChain(config.secretLogPath);

    await logSecretEvent(config, {
      secretId: "KEY_B",
      action: "added",
      actor: "test",
    });

    const fullContent = readFileSync(config.secretLogPath, "utf-8");
    const events = fullContent
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as SecretLifecycleEvent);

    expect(events).toHaveLength(2);
    expect(events[1].prevHmac).toBe(firstEvent.hmac);
    expect(verifyHmacChain(events, HMAC_KEY)).toBe(true);
  });
});

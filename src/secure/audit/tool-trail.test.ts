import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  formatToolAuditJson,
  formatToolAuditTable,
  generateComplianceReport,
  generateToolExportReport,
} from "./tool-format.js";
import type { ToolAuditReport } from "./tool-trail.js";
import {
  appendToolAudit,
  collectToolAudit,
  readToolAuditLog,
  redactSecrets,
  TOOL_AUDIT_FILENAME,
} from "./tool-trail.js";

const TEST_DIR = "/tmp/clawhq-tool-audit-test";
const LOG_PATH = join(TEST_DIR, TOOL_AUDIT_FILENAME);

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

// ── redactSecrets ──────────────────────────────────────────────────

describe("redactSecrets", () => {
  it("redacts Anthropic API keys", () => {
    const input = "calling with key sk-ant-api03-abc123def456ghi789jklmnopqrs";
    expect(redactSecrets(input)).toContain("[REDACTED]");
    expect(redactSecrets(input)).not.toContain("sk-ant-");
  });

  it("redacts OpenAI API keys", () => {
    const input = "key is sk-proj-abcdefghijklmnopqrstuvwxyz";
    expect(redactSecrets(input)).toContain("[REDACTED]");
  });

  it("redacts GitHub PATs", () => {
    const input = "token ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789";
    expect(redactSecrets(input)).toContain("[REDACTED]");
    expect(redactSecrets(input)).not.toContain("ghp_");
  });

  it("redacts AWS access keys", () => {
    const input = "aws key AKIAIOSFODNN7EXAMPLE";
    expect(redactSecrets(input)).toContain("[REDACTED]");
  });

  it("redacts Bearer tokens", () => {
    const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def";
    expect(redactSecrets(input)).toContain("[REDACTED]");
  });

  it("redacts email addresses", () => {
    const input = "sending to user@example.com";
    expect(redactSecrets(input)).toContain("[REDACTED]");
    expect(redactSecrets(input)).not.toContain("user@example.com");
  });

  it("leaves clean input unchanged", () => {
    const input = "fetch calendar events for today";
    expect(redactSecrets(input)).toBe(input);
  });
});

// ── appendToolAudit ────────────────────────────────────────────────

describe("appendToolAudit", () => {
  it("appends a JSONL entry to the log file", async () => {
    await appendToolAudit(
      {
        timestamp: "2026-03-17T10:00:00Z",
        tool: "email",
        input: "fetch inbox",
        output: "3 new messages",
        durationMs: 150,
        status: "success",
      },
      TEST_DIR,
    );

    const content = await readFile(LOG_PATH, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]);
    expect(entry.tool).toBe("email");
    expect(entry.inputRedacted).toBe("fetch inbox");
    expect(entry.outputSummary).toBe("3 new messages");
    expect(entry.durationMs).toBe(150);
    expect(entry.status).toBe("success");
  });

  it("redacts secrets in input", async () => {
    await appendToolAudit(
      {
        timestamp: "2026-03-17T10:00:00Z",
        tool: "tavily",
        input: "search with key sk-ant-api03-abc123def456ghi789jklmnopqrs",
        output: "results found",
        durationMs: 200,
        status: "success",
      },
      TEST_DIR,
    );

    const content = await readFile(LOG_PATH, "utf-8");
    const entry = JSON.parse(content.trim());
    expect(entry.inputRedacted).toContain("[REDACTED]");
    expect(entry.inputRedacted).not.toContain("sk-ant-");
  });

  it("truncates long inputs and outputs", async () => {
    const longInput = "x".repeat(500);
    const longOutput = "y".repeat(500);

    await appendToolAudit(
      {
        timestamp: "2026-03-17T10:00:00Z",
        tool: "tasks",
        input: longInput,
        output: longOutput,
        durationMs: 50,
        status: "success",
      },
      TEST_DIR,
    );

    const content = await readFile(LOG_PATH, "utf-8");
    const entry = JSON.parse(content.trim());
    expect(entry.inputRedacted.length).toBeLessThanOrEqual(200);
    expect(entry.outputSummary.length).toBeLessThanOrEqual(200);
    expect(entry.inputRedacted).toMatch(/\.\.\.$/);
  });

  it("appends multiple entries", async () => {
    for (let i = 0; i < 3; i++) {
      await appendToolAudit(
        {
          timestamp: `2026-03-17T10:0${i}:00Z`,
          tool: "calendar",
          input: `event ${i}`,
          output: `done ${i}`,
          durationMs: 100 + i,
          status: "success",
        },
        TEST_DIR,
      );
    }

    const content = await readFile(LOG_PATH, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(3);
  });
});

// ── readToolAuditLog ───────────────────────────────────────────────

describe("readToolAuditLog", () => {
  it("returns empty array for missing file", async () => {
    const entries = await readToolAuditLog("/tmp/nonexistent/tool-audit.log");
    expect(entries).toEqual([]);
  });

  it("returns empty array for empty file", async () => {
    await writeFile(LOG_PATH, "");
    const entries = await readToolAuditLog(LOG_PATH);
    expect(entries).toEqual([]);
  });

  it("parses valid JSONL entries", async () => {
    const lines = [
      JSON.stringify({
        seq: 1, timestamp: "2026-03-17T10:00:00Z", tool: "email",
        inputRedacted: "fetch inbox", outputSummary: "3 messages",
        durationMs: 150, status: "success",
      }),
      JSON.stringify({
        seq: 2, timestamp: "2026-03-17T10:01:00Z", tool: "tasks",
        inputRedacted: "list tasks", outputSummary: "5 tasks",
        durationMs: 80, status: "success", agentId: "agent-1",
      }),
    ];
    await writeFile(LOG_PATH, lines.join("\n") + "\n");

    const entries = await readToolAuditLog(LOG_PATH);
    expect(entries).toHaveLength(2);
    expect(entries[0].tool).toBe("email");
    expect(entries[1].agentId).toBe("agent-1");
  });

  it("skips malformed lines", async () => {
    const lines = [
      "not json",
      JSON.stringify({
        seq: 1, timestamp: "2026-03-17T10:00:00Z", tool: "email",
        inputRedacted: "test", outputSummary: "ok", durationMs: 50, status: "success",
      }),
      "{broken",
    ];
    await writeFile(LOG_PATH, lines.join("\n") + "\n");

    const entries = await readToolAuditLog(LOG_PATH);
    expect(entries).toHaveLength(1);
  });
});

// ── collectToolAudit ───────────────────────────────────────────────

describe("collectToolAudit", () => {
  it("returns empty report for missing log", async () => {
    const report = await collectToolAudit({
      logPath: "/tmp/nonexistent/tool-audit.log",
    });

    expect(report.summary.totalExecutions).toBe(0);
    expect(report.entries).toEqual([]);
  });

  it("collects and summarizes entries", async () => {
    const now = new Date().toISOString();
    const lines = [
      JSON.stringify({ seq: 1, timestamp: now, tool: "email", inputRedacted: "fetch", outputSummary: "ok", durationMs: 100, status: "success" }),
      JSON.stringify({ seq: 2, timestamp: now, tool: "email", inputRedacted: "send", outputSummary: "sent", durationMs: 200, status: "success" }),
      JSON.stringify({ seq: 3, timestamp: now, tool: "tasks", inputRedacted: "list", outputSummary: "err", durationMs: 50, status: "error" }),
    ];
    await writeFile(LOG_PATH, lines.join("\n") + "\n");

    const report = await collectToolAudit({ logPath: LOG_PATH });

    expect(report.summary.totalExecutions).toBe(3);
    expect(report.summary.successCount).toBe(2);
    expect(report.summary.errorCount).toBe(1);
    expect(report.summary.byTool.email.executions).toBe(2);
    expect(report.summary.byTool.tasks.errors).toBe(1);
  });

  it("filters by since parameter", async () => {
    const old = "2025-01-01T00:00:00Z";
    const recent = new Date().toISOString();
    const lines = [
      JSON.stringify({ seq: 1, timestamp: old, tool: "email", inputRedacted: "old", outputSummary: "ok", durationMs: 100, status: "success" }),
      JSON.stringify({ seq: 2, timestamp: recent, tool: "tasks", inputRedacted: "new", outputSummary: "ok", durationMs: 50, status: "success" }),
    ];
    await writeFile(LOG_PATH, lines.join("\n") + "\n");

    const report = await collectToolAudit({
      logPath: LOG_PATH,
      since: "2026-01-01T00:00:00Z",
    });

    expect(report.summary.totalExecutions).toBe(1);
    expect(report.entries[0].tool).toBe("tasks");
  });

  it("filters by tool name", async () => {
    const now = new Date().toISOString();
    const lines = [
      JSON.stringify({ seq: 1, timestamp: now, tool: "email", inputRedacted: "a", outputSummary: "b", durationMs: 100, status: "success" }),
      JSON.stringify({ seq: 2, timestamp: now, tool: "tasks", inputRedacted: "c", outputSummary: "d", durationMs: 50, status: "success" }),
      JSON.stringify({ seq: 3, timestamp: now, tool: "email", inputRedacted: "e", outputSummary: "f", durationMs: 80, status: "success" }),
    ];
    await writeFile(LOG_PATH, lines.join("\n") + "\n");

    const report = await collectToolAudit({
      logPath: LOG_PATH,
      tool: "email",
    });

    expect(report.summary.totalExecutions).toBe(2);
    expect(report.entries.every((e) => e.tool === "email")).toBe(true);
  });

  it("respects limit parameter", async () => {
    const now = new Date().toISOString();
    const lines = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({ seq: i, timestamp: now, tool: "email", inputRedacted: `msg${i}`, outputSummary: "ok", durationMs: 100, status: "success" }),
    );
    await writeFile(LOG_PATH, lines.join("\n") + "\n");

    const report = await collectToolAudit({ logPath: LOG_PATH, limit: 3 });
    expect(report.entries).toHaveLength(3);
  });
});

// ── formatToolAuditTable ───────────────────────────────────────────

describe("formatToolAuditTable", () => {
  it("shows empty state when no executions", () => {
    const report: ToolAuditReport = {
      since: null,
      until: new Date().toISOString(),
      entries: [],
      summary: {
        totalExecutions: 0, successCount: 0, errorCount: 0,
        byTool: {}, avgDurationMs: 0,
      },
    };

    const output = formatToolAuditTable(report);
    expect(output).toContain("TOOL EXECUTION AUDIT");
    expect(output).toContain("(no tool executions)");
    expect(output).toContain("0 executions, 0 errors");
  });

  it("shows tool summary and execution log", () => {
    const report: ToolAuditReport = {
      since: null,
      until: "2026-03-17T12:00:00Z",
      entries: [
        { seq: 1, timestamp: "2026-03-17T10:00:00Z", tool: "email", inputRedacted: "fetch inbox", outputSummary: "3 messages", durationMs: 150, status: "success" },
        { seq: 2, timestamp: "2026-03-17T10:01:00Z", tool: "tasks", inputRedacted: "list tasks", outputSummary: "error", durationMs: 80, status: "error" },
      ],
      summary: {
        totalExecutions: 2, successCount: 1, errorCount: 1,
        byTool: {
          email: { executions: 1, successes: 1, errors: 0, avgDurationMs: 150 },
          tasks: { executions: 1, successes: 0, errors: 1, avgDurationMs: 80 },
        },
        avgDurationMs: 115,
      },
    };

    const output = formatToolAuditTable(report);
    expect(output).toContain("email");
    expect(output).toContain("tasks");
    expect(output).toContain("EXECUTION LOG");
    expect(output).toContain("2 executions, 1 error");
  });
});

// ── formatToolAuditJson ────────────────────────────────────────────

describe("formatToolAuditJson", () => {
  it("produces valid JSON", () => {
    const report: ToolAuditReport = {
      since: null,
      until: "2026-03-17T12:00:00Z",
      entries: [],
      summary: {
        totalExecutions: 0, successCount: 0, errorCount: 0,
        byTool: {}, avgDurationMs: 0,
      },
    };

    const json = formatToolAuditJson(report);
    const parsed = JSON.parse(json);
    expect(parsed.summary.totalExecutions).toBe(0);
  });
});

// ── generateToolExportReport ───────────────────────────────────────

describe("generateToolExportReport", () => {
  it("includes SHA-256 digest", () => {
    const report: ToolAuditReport = {
      since: null,
      until: "2026-03-17T12:00:00Z",
      entries: [],
      summary: {
        totalExecutions: 0, successCount: 0, errorCount: 0,
        byTool: {}, avgDurationMs: 0,
      },
    };

    const output = generateToolExportReport(report);
    expect(output).toContain("CLAWHQ TOOL EXECUTION AUDIT REPORT");
    expect(output).toContain("SHA-256:");
    expect(output).toMatch(/SHA-256: [0-9a-f]{64}/);
  });
});

// ── generateComplianceReport ───────────────────────────────────────

describe("generateComplianceReport", () => {
  it("generates OWASP GenAI Top 10 compliance report", () => {
    const report: ToolAuditReport = {
      since: "2026-03-01T00:00:00Z",
      until: "2026-03-17T12:00:00Z",
      entries: [
        { seq: 1, timestamp: "2026-03-17T10:00:00Z", tool: "email", inputRedacted: "fetch inbox", outputSummary: "3 messages", durationMs: 150, status: "success" },
        { seq: 2, timestamp: "2026-03-17T10:01:00Z", tool: "tasks", inputRedacted: "list tasks", outputSummary: "error", durationMs: 80, status: "error" },
      ],
      summary: {
        totalExecutions: 2, successCount: 1, errorCount: 1,
        byTool: {
          email: { executions: 1, successes: 1, errors: 0, avgDurationMs: 150 },
          tasks: { executions: 1, successes: 0, errors: 1, avgDurationMs: 80 },
        },
        avgDurationMs: 115,
      },
    };

    const output = generateComplianceReport(report);
    expect(output).toContain("OWASP Top 10 for LLM Applications");
    expect(output).toContain("LLM01");
    expect(output).toContain("LLM02");
    expect(output).toContain("LLM05");
    expect(output).toContain("LLM06");
    expect(output).toContain("LLM07");
    expect(output).toContain("LLM08");
    expect(output).toContain("LLM10");
    expect(output).toContain("Prompt Injection");
    expect(output).toContain("Excessive Agency");
    expect(output).toContain("SHA-256:");
  });

  it("flags redacted content as warning in LLM06", () => {
    const report: ToolAuditReport = {
      since: null,
      until: "2026-03-17T12:00:00Z",
      entries: [
        { seq: 1, timestamp: "2026-03-17T10:00:00Z", tool: "tavily", inputRedacted: "search [REDACTED]", outputSummary: "results", durationMs: 200, status: "success" },
      ],
      summary: {
        totalExecutions: 1, successCount: 1, errorCount: 0,
        byTool: { tavily: { executions: 1, successes: 1, errors: 0, avgDurationMs: 200 } },
        avgDurationMs: 200,
      },
    };

    const output = generateComplianceReport(report);
    expect(output).toContain("[WARN] LLM06");
    expect(output).toContain("Redacted content detected");
  });

  it("shows all PASS when no issues", () => {
    const report: ToolAuditReport = {
      since: null,
      until: "2026-03-17T12:00:00Z",
      entries: [
        { seq: 1, timestamp: "2026-03-17T10:00:00Z", tool: "calendar", inputRedacted: "list events", outputSummary: "2 events", durationMs: 100, status: "success" },
      ],
      summary: {
        totalExecutions: 1, successCount: 1, errorCount: 0,
        byTool: { calendar: { executions: 1, successes: 1, errors: 0, avgDurationMs: 100 } },
        avgDurationMs: 100,
      },
    };

    const output = generateComplianceReport(report);
    expect(output).toContain("[PASS] LLM02");
    expect(output).toContain("[PASS] LLM06");
    expect(output).toContain("[PASS] LLM07");
    expect(output).toContain("[PASS] LLM08");
    expect(output).toContain("[PASS] LLM10");
  });
});

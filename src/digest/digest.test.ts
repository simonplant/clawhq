import { mkdir, rm, writeFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { collectDigestEgress, filterByTimeRange, parseActivityLog } from "./collector.js";
import { formatDigestJson, formatDigestTable } from "./format.js";
import { generateDigest } from "./generator.js";
import type { ActivityEntry, DigestReport } from "./types.js";

const TEST_DIR = "/tmp/clawhq-digest-test";
const ACTIVITY_LOG = `${TEST_DIR}/activity.log`;
const EGRESS_LOG = `${TEST_DIR}/egress.log`;

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

// --- parseActivityLog ---

describe("parseActivityLog", () => {
  it("returns empty array for missing file", async () => {
    const entries = await parseActivityLog("/tmp/nonexistent/activity.log");
    expect(entries).toEqual([]);
  });

  it("returns empty array for empty file", async () => {
    await writeFile(ACTIVITY_LOG, "");
    const entries = await parseActivityLog(ACTIVITY_LOG);
    expect(entries).toEqual([]);
  });

  it("parses valid JSON lines", async () => {
    const now = new Date().toISOString();
    const lines = [
      JSON.stringify({ timestamp: now, type: "task_completed", category: "email", summary: "Triaged 12 emails" }),
      JSON.stringify({ timestamp: now, type: "error", category: "calendar", summary: "CalDAV sync failed", details: "Connection refused" }),
    ];
    await writeFile(ACTIVITY_LOG, lines.join("\n") + "\n");

    const entries = await parseActivityLog(ACTIVITY_LOG);
    expect(entries).toHaveLength(2);
    expect(entries[0].type).toBe("task_completed");
    expect(entries[0].category).toBe("email");
    expect(entries[0].summary).toBe("Triaged 12 emails");
    expect(entries[1].type).toBe("error");
    expect(entries[1].details).toBe("Connection refused");
  });

  it("skips malformed lines", async () => {
    const now = new Date().toISOString();
    const lines = [
      "not json",
      JSON.stringify({ timestamp: now, type: "task_completed", category: "tasks", summary: "Done" }),
      "{broken",
    ];
    await writeFile(ACTIVITY_LOG, lines.join("\n") + "\n");

    const entries = await parseActivityLog(ACTIVITY_LOG);
    expect(entries).toHaveLength(1);
  });

  it("reads approvalRequired field", async () => {
    const now = new Date().toISOString();
    const line = JSON.stringify({
      timestamp: now,
      type: "approval_requested",
      category: "email",
      summary: "Send reply to client",
      approvalRequired: true,
    });
    await writeFile(ACTIVITY_LOG, line + "\n");

    const entries = await parseActivityLog(ACTIVITY_LOG);
    expect(entries[0].approvalRequired).toBe(true);
  });
});

// --- filterByTimeRange ---

describe("filterByTimeRange", () => {
  it("filters entries by time range", () => {
    const entries: ActivityEntry[] = [
      { timestamp: "2026-01-01T00:00:00Z", type: "task_completed", category: "email", summary: "Old" },
      { timestamp: "2026-03-14T10:00:00Z", type: "task_completed", category: "email", summary: "Recent" },
      { timestamp: "2026-12-31T00:00:00Z", type: "task_completed", category: "email", summary: "Future" },
    ];

    const filtered = filterByTimeRange(entries, "2026-03-01T00:00:00Z", "2026-04-01T00:00:00Z");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].summary).toBe("Recent");
  });

  it("returns empty for no matches", () => {
    const entries: ActivityEntry[] = [
      { timestamp: "2025-01-01T00:00:00Z", type: "task_completed", category: "email", summary: "Old" },
    ];

    const filtered = filterByTimeRange(entries, "2026-01-01T00:00:00Z", "2026-12-31T00:00:00Z");
    expect(filtered).toEqual([]);
  });
});

// --- collectDigestEgress ---

describe("collectDigestEgress", () => {
  it("returns zero egress for missing file", async () => {
    const result = await collectDigestEgress("/tmp/nonexistent/egress.log", "2026-01-01T00:00:00Z", new Date().toISOString());
    expect(result.zeroEgress).toBe(true);
    expect(result.totalCalls).toBe(0);
  });

  it("summarizes egress within time range", async () => {
    const now = new Date().toISOString();
    const lines = [
      JSON.stringify({ timestamp: now, provider: "anthropic", bytesOut: 1024 }),
      JSON.stringify({ timestamp: now, provider: "openai", bytesOut: 2048 }),
      JSON.stringify({ timestamp: "2020-01-01T00:00:00Z", provider: "old", bytesOut: 999 }),
    ];
    await writeFile(EGRESS_LOG, lines.join("\n") + "\n");

    const result = await collectDigestEgress(EGRESS_LOG, "2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z");
    expect(result.totalCalls).toBe(2);
    expect(result.totalBytesOut).toBe(3072);
    expect(result.providers).toEqual(["anthropic", "openai"]);
    expect(result.zeroEgress).toBe(false);
  });
});

// --- generateDigest ---

describe("generateDigest", () => {
  it("generates empty digest for missing logs", async () => {
    const report = await generateDigest({
      activityLogPath: "/tmp/nonexistent/activity.log",
      egressLogPath: "/tmp/nonexistent/egress.log",
    });

    expect(report.totalEntries).toBe(0);
    expect(report.tasksCompleted).toEqual([]);
    expect(report.tasksQueued).toEqual([]);
    expect(report.problems).toEqual([]);
    expect(report.egressSummary.zeroEgress).toBe(true);
  });

  it("categorizes entries correctly", async () => {
    const now = new Date().toISOString();
    const lines = [
      JSON.stringify({ timestamp: now, type: "task_completed", category: "email", summary: "Triaged inbox" }),
      JSON.stringify({ timestamp: now, type: "task_completed", category: "tasks", summary: "Scheduled meeting" }),
      JSON.stringify({ timestamp: now, type: "approval_requested", category: "email", summary: "Send reply" }),
      JSON.stringify({ timestamp: now, type: "error", category: "calendar", summary: "Sync failed", details: "Try reconnecting" }),
    ];
    await writeFile(ACTIVITY_LOG, lines.join("\n") + "\n");

    const report = await generateDigest({
      activityLogPath: ACTIVITY_LOG,
      egressLogPath: "/tmp/nonexistent/egress.log",
    });

    expect(report.tasksCompleted).toHaveLength(2);
    expect(report.tasksCompleted).toContain("Triaged inbox");
    expect(report.tasksQueued).toHaveLength(1);
    expect(report.tasksQueued).toContain("Send reply");
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0].problem).toBe("Sync failed");
    expect(report.problems[0].proposal).toBe("Try reconnecting");
  });

  it("privacy mode hides content", async () => {
    const now = new Date().toISOString();
    const lines = [
      JSON.stringify({ timestamp: now, type: "task_completed", category: "email", summary: "Sent confidential reply to Bob" }),
      JSON.stringify({ timestamp: now, type: "error", category: "calendar", summary: "Meeting details leaked", details: "Check logs" }),
    ];
    await writeFile(ACTIVITY_LOG, lines.join("\n") + "\n");

    const report = await generateDigest({
      activityLogPath: ACTIVITY_LOG,
      egressLogPath: "/tmp/nonexistent/egress.log",
      privacyMode: true,
    });

    expect(report.privacyMode).toBe(true);
    expect(report.tasksCompleted[0]).toBe("Task in email");
    expect(report.problems[0].problem).toBe("Issue in calendar");
    expect(report.problems[0].proposal).toBe("Review activity log for details");
  });
});

// --- formatDigestTable ---

describe("formatDigestTable", () => {
  it("renders empty digest", () => {
    const report: DigestReport = {
      since: "2026-03-14T00:00:00Z",
      until: "2026-03-14T23:59:59Z",
      privacyMode: false,
      tasksCompleted: [],
      tasksQueued: [],
      problems: [],
      categories: [],
      egressSummary: { totalCalls: 0, totalBytesOut: 0, providers: [], zeroEgress: true },
      totalEntries: 0,
    };

    const output = formatDigestTable(report);
    expect(output).toContain("ACTIVITY DIGEST");
    expect(output).toContain("(none)");
    expect(output).toContain("ZERO EGRESS");
  });

  it("renders tasks and problems", () => {
    const report: DigestReport = {
      since: "2026-03-14T00:00:00Z",
      until: "2026-03-14T23:59:59Z",
      privacyMode: false,
      tasksCompleted: ["Triaged 12 emails", "Scheduled meeting"],
      tasksQueued: ["Send reply to Bob"],
      problems: [{ problem: "CalDAV sync failed", proposal: "Reconnect", category: "calendar" }],
      categories: [
        { category: "email", count: 13, highlights: ["Triaged 12 emails", "Send reply to Bob"] },
        { category: "calendar", count: 1, highlights: ["CalDAV sync failed"] },
      ],
      egressSummary: { totalCalls: 2, totalBytesOut: 3072, providers: ["anthropic"], zeroEgress: false },
      totalEntries: 14,
    };

    const output = formatDigestTable(report);
    expect(output).toContain("Triaged 12 emails");
    expect(output).toContain("Send reply to Bob");
    expect(output).toContain("CalDAV sync failed");
    expect(output).toContain("Reconnect");
    expect(output).toContain("anthropic");
    expect(output).toContain("14 activities recorded");
  });

  it("shows privacy mode indicator", () => {
    const report: DigestReport = {
      since: "2026-03-14T00:00:00Z",
      until: "2026-03-14T23:59:59Z",
      privacyMode: true,
      tasksCompleted: [],
      tasksQueued: [],
      problems: [],
      categories: [],
      egressSummary: { totalCalls: 0, totalBytesOut: 0, providers: [], zeroEgress: true },
      totalEntries: 0,
    };

    const output = formatDigestTable(report);
    expect(output).toContain("PRIVACY");
  });
});

// --- formatDigestJson ---

describe("formatDigestJson", () => {
  it("produces valid JSON", () => {
    const report: DigestReport = {
      since: "2026-03-14T00:00:00Z",
      until: "2026-03-14T23:59:59Z",
      privacyMode: false,
      tasksCompleted: [],
      tasksQueued: [],
      problems: [],
      categories: [],
      egressSummary: { totalCalls: 0, totalBytesOut: 0, providers: [], zeroEgress: true },
      totalEntries: 0,
    };

    const json = formatDigestJson(report);
    const parsed = JSON.parse(json);
    expect(parsed.egressSummary.zeroEgress).toBe(true);
    expect(parsed.totalEntries).toBe(0);
  });
});

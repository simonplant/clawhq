import { mkdir, rm, writeFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { collectDigestEgress, filterByTimeRange, parseActivityLog, parseCronHistory, readPendingApprovals } from "./collector.js";
import { formatDigestJson, formatDigestTable } from "./format.js";
import { generateDigest } from "./generator.js";
import type { ActivityEntry, DigestReport } from "./types.js";

const TEST_DIR = "/tmp/clawhq-digest-test";
const ACTIVITY_LOG = `${TEST_DIR}/activity.log`;
const EGRESS_LOG = `${TEST_DIR}/egress.log`;
const APPROVALS_FILE = `${TEST_DIR}/approvals.jsonl`;
const CRON_HISTORY = `${TEST_DIR}/cron/history.jsonl`;

const EMPTY_REPORT_FIELDS = {
  pendingApprovals: [],
  cronRuns: [],
  doctorWarnings: [],
};

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
  await mkdir(`${TEST_DIR}/cron`, { recursive: true });
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

// --- readPendingApprovals ---

describe("readPendingApprovals", () => {
  it("returns empty for missing file", async () => {
    const result = await readPendingApprovals("/tmp/nonexistent/approvals.jsonl");
    expect(result).toEqual([]);
  });

  it("reads only pending entries", async () => {
    const lines = [
      JSON.stringify({ id: "a1", status: "pending", category: "email", description: "Send reply", createdAt: "2026-03-14T10:00:00Z" }),
      JSON.stringify({ id: "a2", status: "approved", category: "calendar", description: "Create event", createdAt: "2026-03-14T09:00:00Z" }),
      JSON.stringify({ id: "a3", status: "pending", category: "tasks", description: "Delete item", createdAt: "2026-03-14T11:00:00Z" }),
    ];
    await writeFile(APPROVALS_FILE, lines.join("\n") + "\n");

    const result = await readPendingApprovals(APPROVALS_FILE);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("a1");
    expect(result[0].category).toBe("email");
    expect(result[1].id).toBe("a3");
  });

  it("skips malformed lines", async () => {
    const lines = [
      "{broken",
      JSON.stringify({ id: "a1", status: "pending", category: "email", description: "Send", createdAt: "2026-03-14T10:00:00Z" }),
    ];
    await writeFile(APPROVALS_FILE, lines.join("\n") + "\n");

    const result = await readPendingApprovals(APPROVALS_FILE);
    expect(result).toHaveLength(1);
  });
});

// --- parseCronHistory ---

describe("parseCronHistory", () => {
  it("returns empty for missing file", async () => {
    const result = await parseCronHistory("/tmp/nonexistent/history.jsonl", "2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z");
    expect(result).toEqual([]);
  });

  it("parses cron history within time range", async () => {
    const lines = [
      JSON.stringify({ jobName: "heartbeat", ranAt: "2026-03-14T10:00:00Z", status: "success", summary: "HEARTBEAT_OK" }),
      JSON.stringify({ jobName: "todoist-sync", ranAt: "2026-03-14T10:05:00Z", status: "failure", summary: "Connection timeout" }),
      JSON.stringify({ jobName: "heartbeat", ranAt: "2020-01-01T00:00:00Z", status: "success" }),
    ];
    await writeFile(CRON_HISTORY, lines.join("\n") + "\n");

    const result = await parseCronHistory(CRON_HISTORY, "2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z");
    expect(result).toHaveLength(2);
    expect(result[0].jobName).toBe("heartbeat");
    expect(result[0].status).toBe("success");
    expect(result[1].jobName).toBe("todoist-sync");
    expect(result[1].status).toBe("failure");
    expect(result[1].summary).toBe("Connection timeout");
  });

  it("handles snake_case field names", async () => {
    const lines = [
      JSON.stringify({ job_name: "heartbeat", ran_at: "2026-03-14T10:00:00Z", status: "success" }),
    ];
    await writeFile(CRON_HISTORY, lines.join("\n") + "\n");

    const result = await parseCronHistory(CRON_HISTORY, "2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z");
    expect(result).toHaveLength(1);
    expect(result[0].jobName).toBe("heartbeat");
  });
});

// --- generateDigest ---

describe("generateDigest", () => {
  it("generates empty digest for missing logs", async () => {
    const report = await generateDigest({
      activityLogPath: "/tmp/nonexistent/activity.log",
      egressLogPath: "/tmp/nonexistent/egress.log",
      approvalsPath: "/tmp/nonexistent/approvals.jsonl",
      cronHistoryPath: "/tmp/nonexistent/history.jsonl",
    });

    expect(report.totalEntries).toBe(0);
    expect(report.tasksCompleted).toEqual([]);
    expect(report.tasksQueued).toEqual([]);
    expect(report.problems).toEqual([]);
    expect(report.pendingApprovals).toEqual([]);
    expect(report.cronRuns).toEqual([]);
    expect(report.doctorWarnings).toEqual([]);
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
      approvalsPath: "/tmp/nonexistent/approvals.jsonl",
      cronHistoryPath: "/tmp/nonexistent/history.jsonl",
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
      approvalsPath: "/tmp/nonexistent/approvals.jsonl",
      cronHistoryPath: "/tmp/nonexistent/history.jsonl",
      privacyMode: true,
    });

    expect(report.privacyMode).toBe(true);
    expect(report.tasksCompleted[0]).toBe("Task in email");
    expect(report.problems[0].problem).toBe("Issue in calendar");
    expect(report.problems[0].proposal).toBe("Review activity log for details");
  });

  it("includes pending approvals from queue", async () => {
    const approvalLines = [
      JSON.stringify({ id: "a1", status: "pending", category: "email", description: "Send reply to Bob", createdAt: "2026-03-14T10:00:00Z" }),
      JSON.stringify({ id: "a2", status: "approved", category: "calendar", description: "Already done", createdAt: "2026-03-14T09:00:00Z" }),
    ];
    await writeFile(APPROVALS_FILE, approvalLines.join("\n") + "\n");

    const report = await generateDigest({
      activityLogPath: "/tmp/nonexistent/activity.log",
      egressLogPath: "/tmp/nonexistent/egress.log",
      approvalsPath: APPROVALS_FILE,
      cronHistoryPath: "/tmp/nonexistent/history.jsonl",
    });

    expect(report.pendingApprovals).toHaveLength(1);
    expect(report.pendingApprovals[0].description).toBe("Send reply to Bob");
  });

  it("privacy mode masks approval descriptions", async () => {
    const approvalLines = [
      JSON.stringify({ id: "a1", status: "pending", category: "email", description: "Send confidential reply", createdAt: "2026-03-14T10:00:00Z" }),
    ];
    await writeFile(APPROVALS_FILE, approvalLines.join("\n") + "\n");

    const report = await generateDigest({
      activityLogPath: "/tmp/nonexistent/activity.log",
      egressLogPath: "/tmp/nonexistent/egress.log",
      approvalsPath: APPROVALS_FILE,
      cronHistoryPath: "/tmp/nonexistent/history.jsonl",
      privacyMode: true,
    });

    expect(report.pendingApprovals[0].description).toBe("Pending action in email");
  });

  it("includes cron run history", async () => {
    const now = new Date().toISOString();
    const cronLines = [
      JSON.stringify({ jobName: "heartbeat", ranAt: now, status: "success", summary: "HEARTBEAT_OK" }),
    ];
    await writeFile(CRON_HISTORY, cronLines.join("\n") + "\n");

    const report = await generateDigest({
      activityLogPath: "/tmp/nonexistent/activity.log",
      egressLogPath: "/tmp/nonexistent/egress.log",
      approvalsPath: "/tmp/nonexistent/approvals.jsonl",
      cronHistoryPath: CRON_HISTORY,
    });

    expect(report.cronRuns).toHaveLength(1);
    expect(report.cronRuns[0].jobName).toBe("heartbeat");
    expect(report.cronRuns[0].status).toBe("success");
  });
});

// --- formatDigestTable ---

describe("formatDigestTable", () => {
  it("renders friendly empty state when no data", () => {
    const report: DigestReport = {
      since: "2026-03-14T00:00:00Z",
      until: "2026-03-14T23:59:59Z",
      privacyMode: false,
      tasksCompleted: [],
      tasksQueued: [],
      problems: [],
      categories: [],
      egressSummary: { totalCalls: 0, totalBytesOut: 0, providers: [], zeroEgress: true },
      ...EMPTY_REPORT_FIELDS,
      totalEntries: 0,
    };

    const output = formatDigestTable(report);
    expect(output).toContain("ACTIVITY DIGEST");
    expect(output).toContain("No activity recorded yet");
    expect(output).not.toContain("TASKS COMPLETED");
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
      ...EMPTY_REPORT_FIELDS,
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

  it("renders pending approvals from queue", () => {
    const report: DigestReport = {
      since: "2026-03-14T00:00:00Z",
      until: "2026-03-14T23:59:59Z",
      privacyMode: false,
      tasksCompleted: [],
      tasksQueued: [],
      problems: [],
      categories: [],
      egressSummary: { totalCalls: 0, totalBytesOut: 0, providers: [], zeroEgress: true },
      pendingApprovals: [
        { id: "a1", category: "email", description: "Send reply to Bob", createdAt: "2026-03-14T10:00:00Z" },
      ],
      cronRuns: [],
      doctorWarnings: [],
      totalEntries: 0,
    };

    const output = formatDigestTable(report);
    expect(output).toContain("[email] Send reply to Bob");
    expect(output).toContain("PENDING APPROVAL");
  });

  it("renders cron runs section", () => {
    const report: DigestReport = {
      since: "2026-03-14T00:00:00Z",
      until: "2026-03-14T23:59:59Z",
      privacyMode: false,
      tasksCompleted: ["Did something"],
      tasksQueued: [],
      problems: [],
      categories: [],
      egressSummary: { totalCalls: 0, totalBytesOut: 0, providers: [], zeroEgress: true },
      pendingApprovals: [],
      cronRuns: [
        { jobName: "heartbeat", ranAt: "2026-03-14T10:00:00Z", status: "success", summary: "HEARTBEAT_OK" },
        { jobName: "todoist-sync", ranAt: "2026-03-14T10:05:00Z", status: "failure", summary: "Timeout" },
      ],
      doctorWarnings: [],
      totalEntries: 1,
    };

    const output = formatDigestTable(report);
    expect(output).toContain("CRON RUNS");
    expect(output).toContain("[+] heartbeat");
    expect(output).toContain("[!] todoist-sync");
    expect(output).toContain("HEARTBEAT_OK");
  });

  it("renders doctor warnings in problems section", () => {
    const report: DigestReport = {
      since: "2026-03-14T00:00:00Z",
      until: "2026-03-14T23:59:59Z",
      privacyMode: false,
      tasksCompleted: ["Did something"],
      tasksQueued: [],
      problems: [],
      categories: [],
      egressSummary: { totalCalls: 0, totalBytesOut: 0, providers: [], zeroEgress: true },
      pendingApprovals: [],
      cronRuns: [],
      doctorWarnings: [
        { name: "file-permissions", status: "warn", message: ".env permissions too open", fix: "chmod 600 .env" },
      ],
      totalEntries: 1,
    };

    const output = formatDigestTable(report);
    expect(output).toContain("[doctor:warn] file-permissions");
    expect(output).toContain("chmod 600 .env");
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
      ...EMPTY_REPORT_FIELDS,
      totalEntries: 0,
    };

    const output = formatDigestTable(report);
    expect(output).toContain("PRIVACY");
  });
});

// --- formatDigestJson ---

describe("formatDigestJson", () => {
  it("produces valid JSON with new fields", () => {
    const report: DigestReport = {
      since: "2026-03-14T00:00:00Z",
      until: "2026-03-14T23:59:59Z",
      privacyMode: false,
      tasksCompleted: [],
      tasksQueued: [],
      problems: [],
      categories: [],
      egressSummary: { totalCalls: 0, totalBytesOut: 0, providers: [], zeroEgress: true },
      ...EMPTY_REPORT_FIELDS,
      totalEntries: 0,
    };

    const json = formatDigestJson(report);
    const parsed = JSON.parse(json);
    expect(parsed.egressSummary.zeroEgress).toBe(true);
    expect(parsed.totalEntries).toBe(0);
    expect(parsed.pendingApprovals).toEqual([]);
    expect(parsed.cronRuns).toEqual([]);
    expect(parsed.doctorWarnings).toEqual([]);
  });
});

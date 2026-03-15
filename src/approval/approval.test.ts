import { mkdir, rm, writeFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  formatApprovalJson,
  formatApprovalSummary,
  formatApprovalTable,
  formatApprovalTelegram,
} from "./format.js";
import { enqueue, getPending, getQueueSummary, readQueue } from "./queue.js";
import { approve, expireTimedOut, reject } from "./resolution.js";
import type { ApprovalEntry, ApprovalQueueSummary } from "./types.js";

const TEST_DIR = "/tmp/clawhq-approval-test";
const QUEUE_PATH = `${TEST_DIR}/approvals.jsonl`;

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

// --- readQueue ---

describe("readQueue", () => {
  it("returns empty array for missing file", async () => {
    const entries = await readQueue({ queuePath: "/tmp/nonexistent/approvals.jsonl" });
    expect(entries).toEqual([]);
  });

  it("parses valid entries", async () => {
    const entry = {
      id: "test-1",
      createdAt: "2026-03-14T10:00:00Z",
      status: "pending",
      category: "send_email",
      description: "Send reply to Bob",
      timeoutMs: 86400000,
    };
    await writeFile(QUEUE_PATH, JSON.stringify(entry) + "\n");

    const entries = await readQueue({ queuePath: QUEUE_PATH });
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("test-1");
    expect(entries[0].category).toBe("send_email");
  });

  it("skips malformed lines", async () => {
    const lines = [
      "not json",
      JSON.stringify({ id: "ok", createdAt: "2026-03-14T10:00:00Z", status: "pending", category: "other", description: "Test", timeoutMs: 86400000 }),
    ];
    await writeFile(QUEUE_PATH, lines.join("\n") + "\n");

    const entries = await readQueue({ queuePath: QUEUE_PATH });
    expect(entries).toHaveLength(1);
  });
});

// --- enqueue ---

describe("enqueue", () => {
  it("adds a new entry to the queue", async () => {
    const entry = await enqueue("send_email", "Send reply to Bob", "Draft attached", { queuePath: QUEUE_PATH });

    expect(entry.id).toBeTruthy();
    expect(entry.status).toBe("pending");
    expect(entry.category).toBe("send_email");
    expect(entry.description).toBe("Send reply to Bob");
    expect(entry.details).toBe("Draft attached");

    const entries = await readQueue({ queuePath: QUEUE_PATH });
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(entry.id);
  });

  it("appends to existing entries", async () => {
    await enqueue("send_email", "First", undefined, { queuePath: QUEUE_PATH });
    await enqueue("create_event", "Second", undefined, { queuePath: QUEUE_PATH });

    const entries = await readQueue({ queuePath: QUEUE_PATH });
    expect(entries).toHaveLength(2);
  });
});

// --- getPending ---

describe("getPending", () => {
  it("returns only pending entries", async () => {
    const lines = [
      JSON.stringify({ id: "1", createdAt: new Date().toISOString(), status: "pending", category: "send_email", description: "A", timeoutMs: 86400000 }),
      JSON.stringify({ id: "2", createdAt: "2026-01-01T00:00:00Z", status: "approved", category: "send_email", description: "B", timeoutMs: 86400000 }),
    ];
    await writeFile(QUEUE_PATH, lines.join("\n") + "\n");

    const pending = await getPending({ queuePath: QUEUE_PATH });
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe("1");
  });

  it("expires timed-out entries", async () => {
    const oldTime = new Date(Date.now() - 100_000).toISOString();
    const lines = [
      JSON.stringify({ id: "expired", createdAt: oldTime, status: "pending", category: "send_email", description: "Old", timeoutMs: 1000 }),
    ];
    await writeFile(QUEUE_PATH, lines.join("\n") + "\n");

    const pending = await getPending({ queuePath: QUEUE_PATH });
    expect(pending).toHaveLength(0);

    // Verify it was written as expired
    const all = await readQueue({ queuePath: QUEUE_PATH });
    expect(all[0].status).toBe("expired");
  });
});

// --- approve ---

describe("approve", () => {
  it("approves a pending entry", async () => {
    const entry = await enqueue("send_email", "Test", undefined, { queuePath: QUEUE_PATH });
    const result = await approve(entry.id, { queuePath: QUEUE_PATH });

    expect(result.changed).toBe(true);
    expect(result.entry.status).toBe("approved");
    expect(result.entry.resolvedAt).toBeTruthy();
  });

  it("fails for non-existent ID", async () => {
    const result = await approve("nonexistent", { queuePath: QUEUE_PATH });
    expect(result.changed).toBe(false);
    expect(result.message).toContain("not found");
  });

  it("fails for already resolved entry", async () => {
    const entry = await enqueue("send_email", "Test", undefined, { queuePath: QUEUE_PATH });
    await approve(entry.id, { queuePath: QUEUE_PATH });
    const result = await approve(entry.id, { queuePath: QUEUE_PATH });

    expect(result.changed).toBe(false);
    expect(result.message).toContain("already approved");
  });
});

// --- reject ---

describe("reject", () => {
  it("rejects a pending entry with reason", async () => {
    const entry = await enqueue("send_email", "Test", undefined, { queuePath: QUEUE_PATH });
    const result = await reject(entry.id, "Too informal", { queuePath: QUEUE_PATH });

    expect(result.changed).toBe(true);
    expect(result.entry.status).toBe("rejected");
    expect(result.entry.rejectionReason).toBe("Too informal");
  });

  it("rejects without reason", async () => {
    const entry = await enqueue("send_email", "Test", undefined, { queuePath: QUEUE_PATH });
    const result = await reject(entry.id, undefined, { queuePath: QUEUE_PATH });

    expect(result.changed).toBe(true);
    expect(result.entry.rejectionReason).toBeUndefined();
  });
});

// --- expireTimedOut ---

describe("expireTimedOut", () => {
  it("expires timed-out entries", async () => {
    const oldTime = new Date(Date.now() - 100_000).toISOString();
    const lines = [
      JSON.stringify({ id: "1", createdAt: oldTime, status: "pending", category: "send_email", description: "Old", timeoutMs: 1000 }),
      JSON.stringify({ id: "2", createdAt: new Date().toISOString(), status: "pending", category: "send_email", description: "New", timeoutMs: 86400000 }),
    ];
    await writeFile(QUEUE_PATH, lines.join("\n") + "\n");

    const count = await expireTimedOut({ queuePath: QUEUE_PATH });
    expect(count).toBe(1);

    const all = await readQueue({ queuePath: QUEUE_PATH });
    expect(all[0].status).toBe("expired");
    expect(all[1].status).toBe("pending");
  });

  it("returns 0 when nothing to expire", async () => {
    const count = await expireTimedOut({ queuePath: QUEUE_PATH });
    expect(count).toBe(0);
  });
});

// --- getQueueSummary ---

describe("getQueueSummary", () => {
  it("returns counts by status", async () => {
    const now = new Date().toISOString();
    const lines = [
      JSON.stringify({ id: "1", createdAt: now, status: "pending", category: "send_email", description: "A", timeoutMs: 86400000 }),
      JSON.stringify({ id: "2", createdAt: now, status: "approved", category: "send_email", description: "B", timeoutMs: 86400000 }),
      JSON.stringify({ id: "3", createdAt: now, status: "rejected", category: "send_email", description: "C", timeoutMs: 86400000, rejectionReason: "No" }),
    ];
    await writeFile(QUEUE_PATH, lines.join("\n") + "\n");

    const summary = await getQueueSummary({ queuePath: QUEUE_PATH });
    expect(summary.pending).toBe(1);
    expect(summary.approved).toBe(1);
    expect(summary.rejected).toBe(1);
    expect(summary.expired).toBe(0);
    expect(summary.total).toBe(3);
  });
});

// --- formatApprovalTable ---

describe("formatApprovalTable", () => {
  it("shows empty queue message", () => {
    const output = formatApprovalTable([]);
    expect(output).toContain("APPROVAL QUEUE");
    expect(output).toContain("no pending approvals");
  });

  it("shows pending entries", () => {
    const entries: ApprovalEntry[] = [
      {
        id: "abc-123",
        createdAt: "2026-03-14T10:00:00Z",
        status: "pending",
        category: "send_email",
        description: "Send reply to Bob",
        timeoutMs: 86400000,
      },
    ];

    const output = formatApprovalTable(entries);
    expect(output).toContain("send_email");
    expect(output).toContain("Send reply to Bob");
    expect(output).toContain("abc-123");
  });
});

// --- formatApprovalSummary ---

describe("formatApprovalSummary", () => {
  it("formats summary string", () => {
    const summary: ApprovalQueueSummary = {
      pending: 2,
      approved: 5,
      rejected: 1,
      expired: 0,
      total: 8,
    };

    const output = formatApprovalSummary(summary);
    expect(output).toContain("2 pending");
    expect(output).toContain("5 approved");
    expect(output).toContain("1 rejected");
    expect(output).toContain("8 total");
  });
});

// --- formatApprovalJson ---

describe("formatApprovalJson", () => {
  it("produces valid JSON", () => {
    const entries: ApprovalEntry[] = [
      {
        id: "test-1",
        createdAt: "2026-03-14T10:00:00Z",
        status: "pending",
        category: "send_email",
        description: "Test",
        timeoutMs: 86400000,
      },
    ];

    const json = formatApprovalJson(entries);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("test-1");
  });
});

// --- formatApprovalTelegram ---

describe("formatApprovalTelegram", () => {
  it("formats entry for Telegram notification", () => {
    const entry: ApprovalEntry = {
      id: "abc-123",
      createdAt: "2026-03-14T10:00:00Z",
      status: "pending",
      category: "send_email",
      description: "Send reply to Bob about project deadline",
      details: "Draft: Hi Bob, the deadline is...",
      timeoutMs: 86400000,
    };

    const output = formatApprovalTelegram(entry);
    expect(output).toContain("Approval Required");
    expect(output).toContain("send_email");
    expect(output).toContain("Send reply to Bob");
    expect(output).toContain("abc-123");
    expect(output).toContain("/approve abc-123");
    expect(output).toContain("/reject abc-123");
    expect(output).toContain("Draft: Hi Bob");
  });
});

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAuditConfig, initSeqCounter } from "../../secure/audit/logger.js";
import type { AuditTrailConfig } from "../../secure/audit/types.js";
import {
  approve,
  countPending,
  enqueue,
  getItem,
  listPending,
  loadQueue,
  pruneResolved,
  reject,
} from "./queue.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

let testDir: string;
let deployDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "clawhq-approval-test-"));
  deployDir = join(testDir, "deploy");
  mkdirSync(join(deployDir, "workspace", "memory"), { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ── Enqueue ─────────────────────────────────────────────────────────────────

describe("enqueue", () => {
  it("adds a pending item to the queue", async () => {
    const item = await enqueue(deployDir, {
      category: "send_email",
      summary: "Reply to alice@example.com: Re: Meeting",
      detail: "Hi Alice, Tuesday works for me. Best, User",
      source: "email-digest",
      metadata: { to: "alice@example.com", subject: "Re: Meeting" },
    });

    expect(item.id).toMatch(/^apv-/);
    expect(item.status).toBe("pending");
    expect(item.category).toBe("send_email");
    expect(item.source).toBe("email-digest");
    expect(item.metadata?.to).toBe("alice@example.com");

    // Verify persisted
    const queue = await loadQueue(deployDir);
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]!.id).toBe(item.id);
  });

  it("appends multiple items", async () => {
    await enqueue(deployDir, {
      category: "send_email",
      summary: "Reply 1",
      detail: "body 1",
      source: "email-digest",
    });
    await enqueue(deployDir, {
      category: "send_email",
      summary: "Reply 2",
      detail: "body 2",
      source: "email-digest",
    });

    const queue = await loadQueue(deployDir);
    expect(queue.items).toHaveLength(2);
  });
});

// ── Approve / Reject ────────────────────────────────────────────────────────

describe("approve", () => {
  it("approves a pending item", async () => {
    const item = await enqueue(deployDir, {
      category: "send_email",
      summary: "Reply",
      detail: "body",
      source: "email-digest",
    });

    const result = await approve(deployDir, item.id);
    expect(result.success).toBe(true);

    const updated = await getItem(deployDir, item.id);
    expect(updated?.status).toBe("approved");
    expect(updated?.resolvedAt).toBeDefined();
  });

  it("returns error for non-existent item", async () => {
    const result = await approve(deployDir, "nonexistent");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/);
  });

  it("returns error for already-resolved item", async () => {
    const item = await enqueue(deployDir, {
      category: "send_email",
      summary: "Reply",
      detail: "body",
      source: "email-digest",
    });
    await approve(deployDir, item.id);
    const result = await approve(deployDir, item.id);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already approved/);
  });
});

describe("reject", () => {
  it("rejects a pending item", async () => {
    const item = await enqueue(deployDir, {
      category: "send_email",
      summary: "Reply",
      detail: "body",
      source: "email-digest",
    });

    const result = await reject(deployDir, item.id);
    expect(result.success).toBe(true);

    const updated = await getItem(deployDir, item.id);
    expect(updated?.status).toBe("rejected");
    expect(updated?.resolvedAt).toBeDefined();
  });
});

// ── List / Query ────────────────────────────────────────────────────────────

describe("listPending", () => {
  it("returns only pending items", async () => {
    const item1 = await enqueue(deployDir, {
      category: "send_email",
      summary: "Reply 1",
      detail: "body 1",
      source: "email-digest",
    });
    await enqueue(deployDir, {
      category: "send_email",
      summary: "Reply 2",
      detail: "body 2",
      source: "email-digest",
    });

    // Approve item1
    await approve(deployDir, item1.id);

    const pending = await listPending(deployDir);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.summary).toBe("Reply 2");
  });

  it("returns empty array when no pending items", async () => {
    const pending = await listPending(deployDir);
    expect(pending).toHaveLength(0);
  });
});

describe("countPending", () => {
  it("counts all pending items", async () => {
    await enqueue(deployDir, {
      category: "send_email",
      summary: "Reply 1",
      detail: "body 1",
      source: "email-digest",
    });
    await enqueue(deployDir, {
      category: "send_message",
      summary: "Message 1",
      detail: "body",
      source: "other-skill",
    });

    expect(await countPending(deployDir)).toBe(2);
  });

  it("counts pending items filtered by source", async () => {
    await enqueue(deployDir, {
      category: "send_email",
      summary: "Reply 1",
      detail: "body 1",
      source: "email-digest",
    });
    await enqueue(deployDir, {
      category: "send_message",
      summary: "Message 1",
      detail: "body",
      source: "other-skill",
    });

    expect(await countPending(deployDir, "email-digest")).toBe(1);
    expect(await countPending(deployDir, "other-skill")).toBe(1);
  });
});

// ── Prune ───────────────────────────────────────────────────────────────────

describe("pruneResolved", () => {
  it("removes resolved items older than max age", async () => {
    const item = await enqueue(deployDir, {
      category: "send_email",
      summary: "Reply",
      detail: "body",
      source: "email-digest",
    });
    await approve(deployDir, item.id);

    // Prune with 0ms max age → everything resolved is pruned
    const pruned = await pruneResolved(deployDir, 0);
    expect(pruned).toBe(1);

    const queue = await loadQueue(deployDir);
    expect(queue.items).toHaveLength(0);
  });

  it("keeps pending items regardless of age", async () => {
    await enqueue(deployDir, {
      category: "send_email",
      summary: "Reply",
      detail: "body",
      source: "email-digest",
    });

    const pruned = await pruneResolved(deployDir, 0);
    expect(pruned).toBe(0);

    const queue = await loadQueue(deployDir);
    expect(queue.items).toHaveLength(1);
  });
});

// ── Queue file resilience ───────────────────────────────────────────────────

describe("loadQueue", () => {
  it("returns empty queue when file does not exist", async () => {
    const queue = await loadQueue(deployDir);
    expect(queue.version).toBe(1);
    expect(queue.items).toHaveLength(0);
  });

  it("returns empty queue when file is invalid JSON", async () => {
    const queueFile = join(deployDir, "workspace", "memory", "approval-queue.json");
    writeFileSync(queueFile, "not valid json");
    const queue = await loadQueue(deployDir);
    expect(queue.items).toHaveLength(0);
  });
});

// ── Audit Trail Integration ────────────────────────────────────────────────

describe("audit trail integration", () => {
  let auditConfig: AuditTrailConfig;

  beforeEach(async () => {
    mkdirSync(join(deployDir, "ops", "audit"), { recursive: true });
    auditConfig = createAuditConfig(deployDir, "");
    await initSeqCounter(auditConfig.approvalLogPath);
  });

  it("logs approval resolution to audit trail", async () => {
    const item = await enqueue(deployDir, {
      category: "send_email",
      summary: "Reply to alice",
      detail: "body",
      source: "email-digest",
    });

    await approve(deployDir, item.id, { resolvedVia: "cli", auditConfig });

    const content = readFileSync(auditConfig.approvalLogPath, "utf-8");
    const event = JSON.parse(content.trim());
    expect(event.type).toBe("approval_resolution");
    expect(event.itemId).toBe(item.id);
    expect(event.resolution).toBe("approved");
    expect(event.resolvedVia).toBe("cli");
    expect(event.source).toBe("email-digest");
    expect(event.category).toBe("send_email");
  });

  it("logs rejection to audit trail", async () => {
    const item = await enqueue(deployDir, {
      category: "purchase",
      summary: "Buy 10 shares AAPL",
      detail: "market order",
      source: "trading-bot",
    });

    await reject(deployDir, item.id, { resolvedVia: "telegram", auditConfig });

    const content = readFileSync(auditConfig.approvalLogPath, "utf-8");
    const event = JSON.parse(content.trim());
    expect(event.type).toBe("approval_resolution");
    expect(event.resolution).toBe("rejected");
    expect(event.resolvedVia).toBe("telegram");
  });

  it("does not log audit when no auditConfig provided", async () => {
    const item = await enqueue(deployDir, {
      category: "send_email",
      summary: "Reply",
      detail: "body",
      source: "test",
    });

    await approve(deployDir, item.id);

    expect(existsSync(auditConfig.approvalLogPath)).toBe(false);
  });
});

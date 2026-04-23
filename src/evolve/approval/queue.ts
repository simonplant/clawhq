/**
 * File-based approval queue for high-stakes agent actions.
 *
 * Proposed actions (email replies, message sends, etc.) are queued
 * as JSON items in `workspace/memory/approval-queue.json`.
 * The user reviews and approves/rejects via their messaging channel.
 *
 * No action executes without explicit user consent.
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { DIR_MODE_SECRET, FILE_MODE_SECRET } from "../../config/defaults.js";
import { writeFileAtomic } from "../../config/fs-atomic.js";
import { logApprovalResolution } from "../../secure/audit/logger.js";
import type { AuditTrailConfig } from "../../secure/audit/types.js";

import type {
  ApprovalItem,
  ApprovalQueue,
  EnqueueOptions,
  ResolveOptions,
} from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const QUEUE_FILENAME = "approval-queue.json";

/** Maximum pending items before oldest are expired. */
const MAX_PENDING_ITEMS = 100;

// ── Queue I/O ───────────────────────────────────────────────────────────────

function queuePath(deployDir: string): string {
  return join(deployDir, "workspace", "memory", QUEUE_FILENAME);
}

export async function loadQueue(deployDir: string): Promise<ApprovalQueue> {
  const path = queuePath(deployDir);
  if (!existsSync(path)) {
    return { version: 1, items: [] };
  }
  // Silent empty-fallback here used to drop every pending approval on a
  // single corrupted write. Now fails loud so the user can inspect the
  // .bak or re-queue manually.
  const raw = await readFile(path, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `approval queue at ${path} is corrupt: ${msg}. ` +
      `Pending approvals need to be inspected manually (.bak may help) or re-proposed; ` +
      `do not run \`clawhq\` commands that enqueue approvals until this is resolved.`,
      { cause: err },
    );
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as Record<string, unknown>).items)) {
    throw new Error(`approval queue at ${path} is missing the \`items\` array`);
  }
  return parsed as ApprovalQueue;
}

async function saveQueue(
  deployDir: string,
  queue: ApprovalQueue,
): Promise<void> {
  const dir = join(deployDir, "workspace", "memory");
  mkdirSync(dir, { recursive: true, mode: DIR_MODE_SECRET });
  writeFileAtomic(queuePath(deployDir), JSON.stringify(queue, null, 2) + "\n", FILE_MODE_SECRET);
}

// ── Generate ID ─────────────────────────────────────────────────────────────

function generateApprovalId(): string {
  const ts = Date.now().toString(36);
  const rand = randomBytes(4).toString("hex");
  return `apv-${ts}-${rand}`;
}

// ── Enqueue ─────────────────────────────────────────────────────────────────

/**
 * Add a proposed action to the approval queue.
 *
 * Returns the created approval item with its assigned ID.
 */
export async function enqueue(
  deployDir: string,
  options: EnqueueOptions,
): Promise<ApprovalItem> {
  const queue = await loadQueue(deployDir);

  const item: ApprovalItem = {
    id: generateApprovalId(),
    category: options.category,
    summary: options.summary,
    detail: options.detail,
    source: options.source,
    status: "pending",
    createdAt: new Date().toISOString(),
    metadata: options.metadata,
  };

  // Expire oldest pending items if queue is full
  let items = [...queue.items];
  const pendingCount = items.filter((i) => i.status === "pending").length;
  if (pendingCount >= MAX_PENDING_ITEMS) {
    items = expireOldest(items);
  }

  items.push(item);

  await saveQueue(deployDir, { version: 1, items });
  return item;
}

// ── Resolve ─────────────────────────────────────────────────────────────────

/**
 * Approve a pending item by ID.
 */
export async function approve(
  deployDir: string,
  itemId: string,
  opts?: ResolveOptions & { auditConfig?: AuditTrailConfig },
): Promise<{ success: boolean; error?: string }> {
  return resolveItem(deployDir, itemId, "approved", opts);
}

/**
 * Reject a pending item by ID.
 */
export async function reject(
  deployDir: string,
  itemId: string,
  opts?: ResolveOptions & { auditConfig?: AuditTrailConfig },
): Promise<{ success: boolean; error?: string }> {
  return resolveItem(deployDir, itemId, "rejected", opts);
}

async function resolveItem(
  deployDir: string,
  itemId: string,
  status: "approved" | "rejected",
  opts?: ResolveOptions & { auditConfig?: AuditTrailConfig },
): Promise<{ success: boolean; error?: string }> {
  const queue = await loadQueue(deployDir);
  const idx = queue.items.findIndex((i) => i.id === itemId);

  if (idx === -1) {
    return { success: false, error: `Approval item "${itemId}" not found.` };
  }

  const item = queue.items[idx];
  if (item.status !== "pending") {
    return {
      success: false,
      error: `Item "${itemId}" is already ${item.status}.`,
    };
  }

  const updated: ApprovalItem = {
    ...item,
    status,
    resolvedAt: new Date().toISOString(),
  };

  const items = [...queue.items];
  items[idx] = updated;

  await saveQueue(deployDir, { version: 1, items });

  // Log resolution to audit trail (never throws — errors caught internally)
  if (opts?.auditConfig) {
    await logApprovalResolution(opts.auditConfig, {
      itemId: item.id,
      category: item.category,
      summary: item.summary,
      resolution: status,
      resolvedVia: opts.resolvedVia ?? "cli",
      source: item.source,
    });
  }

  return { success: true };
}

// ── List / Query ────────────────────────────────────────────────────────────

/**
 * List all pending approval items.
 */
export async function listPending(
  deployDir: string,
): Promise<readonly ApprovalItem[]> {
  const queue = await loadQueue(deployDir);
  return queue.items.filter((i) => i.status === "pending");
}

/**
 * Get a single approval item by ID.
 */
export async function getItem(
  deployDir: string,
  itemId: string,
): Promise<ApprovalItem | undefined> {
  const queue = await loadQueue(deployDir);
  return queue.items.find((i) => i.id === itemId);
}

/**
 * Count pending items, optionally filtered by source.
 */
export async function countPending(
  deployDir: string,
  source?: string,
): Promise<number> {
  const queue = await loadQueue(deployDir);
  const pending = queue.items.filter((i) => i.status === "pending");
  if (source) {
    return pending.filter((i) => i.source === source).length;
  }
  return pending.length;
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

/**
 * Remove resolved items older than the given age (in milliseconds).
 * Keeps pending items regardless of age.
 */
export async function pruneResolved(
  deployDir: string,
  maxAgeMs: number,
): Promise<number> {
  const queue = await loadQueue(deployDir);
  const cutoff = Date.now() - maxAgeMs;

  const kept: ApprovalItem[] = [];
  let pruned = 0;

  for (const item of queue.items) {
    if (item.status === "pending") {
      kept.push(item);
      continue;
    }
    const resolvedTime = item.resolvedAt
      ? new Date(item.resolvedAt).getTime()
      : 0;
    if (resolvedTime > cutoff) {
      kept.push(item);
    } else {
      pruned++;
    }
  }

  if (pruned > 0) {
    await saveQueue(deployDir, { version: 1, items: kept });
  }

  return pruned;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Expire the oldest pending items to stay under MAX_PENDING_ITEMS. */
function expireOldest(items: ApprovalItem[]): ApprovalItem[] {
  const pending = items
    .filter((i) => i.status === "pending")
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const toExpire = new Set(
    pending.slice(0, pending.length - MAX_PENDING_ITEMS + 1).map((i) => i.id),
  );

  return items.map((i) =>
    toExpire.has(i.id)
      ? { ...i, status: "expired" as const, resolvedAt: new Date().toISOString() }
      : i,
  );
}

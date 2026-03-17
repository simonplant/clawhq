/**
 * Approval queue implementation.
 *
 * Stores pending approvals in a JSON Lines file. Actions in
 * requires-approval categories are queued here and resolved
 * via approve, reject, or expiry.
 */

import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import { notifyApprovalPending } from "../notifications/hooks.js";
import type {
  ApprovalCategory,
  ApprovalEntry,
  ApprovalQueueOptions,
  ApprovalQueueSummary,
  ApprovalStatus,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 86_400_000; // 24 hours

function resolveHome(openclawHome: string): string {
  return openclawHome.replace(/^~/, process.env.HOME ?? "~");
}

function resolveQueuePath(options: ApprovalQueueOptions): string {
  if (options.queuePath) return options.queuePath;
  const home = resolveHome(options.openclawHome ?? "~/.openclaw");
  return `${home}/approvals.jsonl`;
}

/**
 * Read all approval entries from the queue file.
 */
export async function readQueue(options: ApprovalQueueOptions = {}): Promise<ApprovalEntry[]> {
  const queuePath = resolveQueuePath(options);

  let content: string;
  try {
    content = await readFile(queuePath, "utf-8");
  } catch {
    return [];
  }

  const entries: ApprovalEntry[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const raw = JSON.parse(trimmed) as Record<string, unknown>;
      entries.push({
        id: String(raw.id ?? ""),
        createdAt: String(raw.createdAt ?? ""),
        status: String(raw.status ?? "pending") as ApprovalStatus,
        category: String(raw.category ?? "other") as ApprovalCategory,
        description: String(raw.description ?? ""),
        details: raw.details != null ? String(raw.details) : undefined,
        resolvedAt: raw.resolvedAt != null ? String(raw.resolvedAt) : undefined,
        rejectionReason: raw.rejectionReason != null ? String(raw.rejectionReason) : undefined,
        timeoutMs: Number(raw.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch {
      // Skip malformed lines
    }
  }

  return entries;
}

/**
 * Write the full queue back to disk.
 */
export async function writeQueue(
  entries: ApprovalEntry[],
  options: ApprovalQueueOptions = {},
): Promise<void> {
  const queuePath = resolveQueuePath(options);
  const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await writeFile(queuePath, content, "utf-8");
}

/**
 * Add a new approval request to the queue.
 */
export async function enqueue(
  category: ApprovalCategory,
  description: string,
  details?: string,
  options: ApprovalQueueOptions = {},
): Promise<ApprovalEntry> {
  const entries = await readQueue(options);
  const timeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  const entry: ApprovalEntry = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    status: "pending",
    category,
    description,
    details,
    timeoutMs,
  };

  entries.push(entry);
  await writeQueue(entries, options);

  // Fire notification (best-effort, never blocks)
  void notifyApprovalPending(entry);

  return entry;
}

/**
 * Get all pending approval entries, expiring any that have timed out.
 */
export async function getPending(options: ApprovalQueueOptions = {}): Promise<ApprovalEntry[]> {
  const entries = await readQueue(options);
  const now = Date.now();
  let changed = false;

  for (const entry of entries) {
    if (entry.status !== "pending") continue;
    const createdMs = new Date(entry.createdAt).getTime();
    if (now - createdMs > entry.timeoutMs) {
      entry.status = "expired";
      entry.resolvedAt = new Date().toISOString();
      changed = true;
    }
  }

  if (changed) {
    await writeQueue(entries, options);
  }

  return entries.filter((e) => e.status === "pending");
}

/**
 * Get a summary of the approval queue.
 */
export async function getQueueSummary(options: ApprovalQueueOptions = {}): Promise<ApprovalQueueSummary> {
  // getPending triggers expiry of timed-out entries
  await getPending(options);
  const entries = await readQueue(options);

  const counts: ApprovalQueueSummary = {
    pending: 0,
    approved: 0,
    rejected: 0,
    expired: 0,
    total: entries.length,
  };

  for (const entry of entries) {
    counts[entry.status]++;
  }

  return counts;
}

/**
 * Approval resolution.
 *
 * Handles approve, reject (with reason as preference signal),
 * and expire operations on queued approvals.
 */

import { readQueue, writeQueue } from "./queue.js";
import type { ApprovalQueueOptions, ApprovalResult } from "./types.js";

/**
 * Approve a pending approval by ID.
 */
export async function approve(
  id: string,
  options: ApprovalQueueOptions = {},
): Promise<ApprovalResult> {
  const entries = await readQueue(options);
  const entry = entries.find((e) => e.id === id);

  if (!entry) {
    return {
      entry: { id, createdAt: "", status: "pending", category: "other", description: "", timeoutMs: 0 },
      changed: false,
      message: `Approval ${id} not found`,
    };
  }

  if (entry.status !== "pending") {
    return {
      entry,
      changed: false,
      message: `Approval ${id} is already ${entry.status}`,
    };
  }

  entry.status = "approved";
  entry.resolvedAt = new Date().toISOString();
  await writeQueue(entries, options);

  return {
    entry,
    changed: true,
    message: `Approved: ${entry.description}`,
  };
}

/**
 * Reject a pending approval by ID.
 * The rejection reason is stored as a preference signal for behavioral training.
 */
export async function reject(
  id: string,
  reason?: string,
  options: ApprovalQueueOptions = {},
): Promise<ApprovalResult> {
  const entries = await readQueue(options);
  const entry = entries.find((e) => e.id === id);

  if (!entry) {
    return {
      entry: { id, createdAt: "", status: "pending", category: "other", description: "", timeoutMs: 0 },
      changed: false,
      message: `Approval ${id} not found`,
    };
  }

  if (entry.status !== "pending") {
    return {
      entry,
      changed: false,
      message: `Approval ${id} is already ${entry.status}`,
    };
  }

  entry.status = "rejected";
  entry.resolvedAt = new Date().toISOString();
  entry.rejectionReason = reason;
  await writeQueue(entries, options);

  return {
    entry,
    changed: true,
    message: `Rejected: ${entry.description}${reason ? ` (reason: ${reason})` : ""}`,
  };
}

/**
 * Expire all timed-out pending approvals.
 * Returns the number of entries expired.
 */
export async function expireTimedOut(options: ApprovalQueueOptions = {}): Promise<number> {
  const entries = await readQueue(options);
  const now = Date.now();
  let count = 0;

  for (const entry of entries) {
    if (entry.status !== "pending") continue;
    const createdMs = new Date(entry.createdAt).getTime();
    if (now - createdMs > entry.timeoutMs) {
      entry.status = "expired";
      entry.resolvedAt = new Date().toISOString();
      count++;
    }
  }

  if (count > 0) {
    await writeQueue(entries, options);
  }

  return count;
}

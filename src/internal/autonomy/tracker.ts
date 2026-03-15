/**
 * Approval pattern tracker.
 *
 * Reads the approval queue history and computes per-category statistics
 * (approval rate, rejection rate, sample size) used by the analyzer
 * to generate autonomy recommendations.
 */

import { readQueue } from "../../approval/queue.js";
import type { ApprovalCategory, ApprovalEntry, ApprovalQueueOptions } from "../../approval/types.js";

import type { CategoryStats } from "./types.js";

/**
 * Compute per-category statistics from resolved approval entries.
 *
 * Only entries with status "approved" or "rejected" count toward
 * the approval/rejection rates. Expired entries are tracked but
 * excluded from rate calculations.
 */
export function computeCategoryStats(entries: ApprovalEntry[]): CategoryStats[] {
  const buckets = new Map<
    ApprovalCategory,
    { approved: number; rejected: number; expired: number }
  >();

  for (const entry of entries) {
    if (entry.status === "pending") continue;

    let bucket = buckets.get(entry.category);
    if (!bucket) {
      bucket = { approved: 0, rejected: 0, expired: 0 };
      buckets.set(entry.category, bucket);
    }

    if (entry.status === "approved") bucket.approved++;
    else if (entry.status === "rejected") bucket.rejected++;
    else if (entry.status === "expired") bucket.expired++;
  }

  const stats: CategoryStats[] = [];

  for (const [category, bucket] of buckets) {
    const total = bucket.approved + bucket.rejected;
    stats.push({
      category,
      total,
      approved: bucket.approved,
      rejected: bucket.rejected,
      expired: bucket.expired,
      approvalRate: total > 0 ? bucket.approved / total : 0,
      rejectionRate: total > 0 ? bucket.rejected / total : 0,
    });
  }

  // Sort by total descending for consistent output
  stats.sort((a, b) => b.total - a.total);

  return stats;
}

/**
 * Load the approval queue and compute category statistics.
 */
export async function trackPatterns(
  options: ApprovalQueueOptions = {},
): Promise<CategoryStats[]> {
  const entries = await readQueue(options);
  return computeCategoryStats(entries);
}

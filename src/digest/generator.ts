/**
 * Digest generator.
 *
 * Assembles a DigestReport from activity log entries and egress data.
 * In privacy mode, summaries use category counts only (no content).
 */

import { collectDigestEgress, filterByTimeRange, parseActivityLog } from "./collector.js";
import type {
  ActivityCategory,
  ActivityEntry,
  CategorySummary,
  DigestOptions,
  DigestReport,
  ProblemEntry,
} from "./types.js";

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function resolveHome(openclawHome: string): string {
  return openclawHome.replace(/^~/, process.env.HOME ?? "~");
}

/**
 * Build category summaries from activity entries.
 */
function buildCategorySummaries(
  entries: ActivityEntry[],
  privacyMode: boolean,
): CategorySummary[] {
  const byCategory = new Map<ActivityCategory, ActivityEntry[]>();

  for (const entry of entries) {
    const existing = byCategory.get(entry.category) ?? [];
    existing.push(entry);
    byCategory.set(entry.category, existing);
  }

  const summaries: CategorySummary[] = [];
  for (const [category, catEntries] of byCategory) {
    const highlights: string[] = [];

    if (privacyMode) {
      highlights.push(`${catEntries.length} action${catEntries.length === 1 ? "" : "s"} performed`);
    } else {
      // Show up to 5 summaries per category
      for (const entry of catEntries.slice(0, 5)) {
        highlights.push(entry.summary);
      }
      if (catEntries.length > 5) {
        highlights.push(`... and ${catEntries.length - 5} more`);
      }
    }

    summaries.push({ category, count: catEntries.length, highlights });
  }

  // Sort by count descending
  summaries.sort((a, b) => b.count - a.count);
  return summaries;
}

/**
 * Extract problems from error entries.
 */
function extractProblems(
  entries: ActivityEntry[],
  privacyMode: boolean,
): ProblemEntry[] {
  const problems: ProblemEntry[] = [];

  for (const entry of entries) {
    if (entry.type !== "error") continue;

    if (privacyMode) {
      problems.push({
        problem: `Issue in ${entry.category}`,
        proposal: "Review activity log for details",
        category: entry.category,
      });
    } else {
      problems.push({
        problem: entry.summary,
        proposal: entry.details ?? "Review activity log for details",
        category: entry.category,
      });
    }
  }

  return problems;
}

/**
 * Generate a digest report from the activity and egress logs.
 */
export async function generateDigest(options: DigestOptions = {}): Promise<DigestReport> {
  const home = resolveHome(options.openclawHome ?? "~/.openclaw");
  const activityLogPath = options.activityLogPath ?? `${home}/activity.log`;
  const egressLogPath = options.egressLogPath ?? `${home}/egress.log`;
  const now = new Date();
  const since = options.since ?? startOfDay(now).toISOString();
  const until = options.until ?? now.toISOString();
  const privacyMode = options.privacyMode ?? false;

  // Collect activity entries
  const allEntries = await parseActivityLog(activityLogPath);
  const entries = filterByTimeRange(allEntries, since, until);

  // Extract completed tasks
  const tasksCompleted = entries
    .filter((e) => e.type === "task_completed")
    .map((e) => privacyMode ? `Task in ${e.category}` : e.summary);

  // Extract queued tasks (pending approval)
  const tasksQueued = entries
    .filter((e) => e.type === "approval_requested")
    .map((e) => privacyMode ? `Pending approval in ${e.category}` : e.summary);

  // Extract problems
  const problems = extractProblems(entries, privacyMode);

  // Build category summaries
  const categories = buildCategorySummaries(entries, privacyMode);

  // Collect egress summary
  const egressSummary = await collectDigestEgress(egressLogPath, since, until);

  return {
    since,
    until,
    privacyMode,
    tasksCompleted,
    tasksQueued,
    problems,
    categories,
    egressSummary,
    totalEntries: entries.length,
  };
}

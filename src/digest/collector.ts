/**
 * Activity log collector.
 *
 * Reads the activity log (JSON Lines) and egress log to gather
 * actions, errors, egress, and approvals from a given period.
 */

import { readFile } from "node:fs/promises";

import type { ActivityEntry, DigestEgressSummary } from "./types.js";

/**
 * Parse the activity log file (JSON Lines format).
 *
 * Each line is a JSON object with at minimum: timestamp, type, category, summary.
 */
export async function parseActivityLog(logPath: string): Promise<ActivityEntry[]> {
  let content: string;
  try {
    content = await readFile(logPath, "utf-8");
  } catch {
    return [];
  }

  const entries: ActivityEntry[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const raw = JSON.parse(trimmed) as Record<string, unknown>;
      entries.push({
        timestamp: String(raw.timestamp ?? ""),
        type: String(raw.type ?? "other") as ActivityEntry["type"],
        category: String(raw.category ?? "other") as ActivityEntry["category"],
        summary: String(raw.summary ?? ""),
        details: raw.details != null ? String(raw.details) : undefined,
        source: raw.source != null ? String(raw.source) : undefined,
        approvalRequired: raw.approvalRequired === true,
      });
    } catch {
      // Skip malformed lines
    }
  }

  return entries;
}

/**
 * Filter activity entries by time range.
 */
export function filterByTimeRange(
  entries: ActivityEntry[],
  since: string,
  until: string,
): ActivityEntry[] {
  const sinceMs = new Date(since).getTime();
  const untilMs = new Date(until).getTime();

  return entries.filter((e) => {
    const ts = new Date(e.timestamp).getTime();
    return ts >= sinceMs && ts <= untilMs;
  });
}

/** Egress log entry (minimal shape needed for digest). */
interface EgressLogEntry {
  timestamp: string;
  provider: string;
  bytesOut: number;
}

/**
 * Collect egress summary for the digest from the egress log.
 */
export async function collectDigestEgress(
  egressLogPath: string,
  since: string,
  until: string,
): Promise<DigestEgressSummary> {
  let content: string;
  try {
    content = await readFile(egressLogPath, "utf-8");
  } catch {
    return { totalCalls: 0, totalBytesOut: 0, providers: [], zeroEgress: true };
  }

  const sinceMs = new Date(since).getTime();
  const untilMs = new Date(until).getTime();
  let totalCalls = 0;
  let totalBytesOut = 0;
  const providerSet = new Set<string>();

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const raw = JSON.parse(trimmed) as Record<string, unknown>;
      const entry: EgressLogEntry = {
        timestamp: String(raw.timestamp ?? ""),
        provider: String(raw.provider ?? "unknown"),
        bytesOut: Number(raw.bytesOut ?? raw.bytes_out ?? 0),
      };

      const ts = new Date(entry.timestamp).getTime();
      if (ts >= sinceMs && ts <= untilMs) {
        totalCalls++;
        totalBytesOut += entry.bytesOut;
        providerSet.add(entry.provider);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return {
    totalCalls,
    totalBytesOut,
    providers: [...providerSet].sort(),
    zeroEgress: totalCalls === 0,
  };
}

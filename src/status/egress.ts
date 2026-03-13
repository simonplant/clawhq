/**
 * Data egress collector.
 *
 * Reads the egress log file to compute bytes sent to cloud providers
 * over different time periods (today, this week, this month).
 * Displays zero-egress badge when no cloud calls were made.
 */

import { readFile } from "node:fs/promises";

import type { EgressPeriod, EgressSummary } from "./types.js";

/**
 * A single egress log entry (one line in the log file).
 * Format: JSON lines with timestamp, provider, bytes, etc.
 */
interface EgressLogEntry {
  timestamp: string;
  provider: string;
  bytesOut: number;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function startOfMonth(date: Date): Date {
  const d = startOfDay(date);
  d.setDate(1);
  return d;
}

function sumPeriod(entries: EgressLogEntry[], since: Date): EgressPeriod {
  const sinceMs = since.getTime();
  let bytes = 0;
  let calls = 0;

  for (const entry of entries) {
    if (new Date(entry.timestamp).getTime() >= sinceMs) {
      bytes += entry.bytesOut;
      calls++;
    }
  }

  return { label: "", bytes, calls };
}

/**
 * Parse the egress log file (JSON lines format).
 */
async function parseEgressLog(logPath: string): Promise<EgressLogEntry[]> {
  let content: string;
  try {
    content = await readFile(logPath, "utf-8");
  } catch {
    return [];
  }

  const entries: EgressLogEntry[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as Record<string, unknown>;
      entries.push({
        timestamp: String(entry.timestamp ?? ""),
        provider: String(entry.provider ?? ""),
        bytesOut: Number(entry.bytesOut ?? entry.bytes_out ?? 0),
      });
    } catch {
      // Skip malformed lines
    }
  }

  return entries;
}

/**
 * Collect data egress summary from the egress log.
 */
export async function collectEgressSummary(options: {
  egressLogPath?: string;
  openclawHome?: string;
} = {}): Promise<EgressSummary> {
  const home = (options.openclawHome ?? "~/.openclaw").replace(
    /^~/,
    process.env.HOME ?? "~",
  );
  const logPath = options.egressLogPath ?? `${home}/egress.log`;

  const entries = await parseEgressLog(logPath);
  const now = new Date();

  const today = sumPeriod(entries, startOfDay(now));
  today.label = "today";

  const week = sumPeriod(entries, startOfWeek(now));
  week.label = "this week";

  const month = sumPeriod(entries, startOfMonth(now));
  month.label = "this month";

  const zeroEgress = month.bytes === 0;

  return { today, week, month, zeroEgress };
}

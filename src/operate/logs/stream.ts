/**
 * Log streaming and cron history for ClawHQ.
 *
 * Streams Docker container logs with optional category filtering,
 * and reads cron execution history from the OpenClaw cron/runs directory.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { DockerClient } from "../../build/docker/client.js";

import type { CronRunEntry, LogCategory, LogsOptions } from "./types.js";

/**
 * Category keywords used to filter log lines.
 * Each category maps to patterns that appear in agent log output.
 */
const CATEGORY_PATTERNS: Record<LogCategory, RegExp> = {
  agent: /\bagent\b|\bsession\b|\btool\b|\bskill\b/i,
  gateway: /\bgateway\b|\bwebsocket\b|\bconfig\b|\bhealth\b/i,
  cron: /\bcron\b|\bscheduled\b|\bjob\b/i,
  error: /\berror\b|\bfail\b|\bcrash\b|\bpanic\b|\bexception\b/i,
};

/**
 * Parse a human-readable duration string into a Docker-compatible --since value.
 * Supports: "30s", "5m", "1h", "2d" → converts to Docker duration format.
 */
export function parseSinceDuration(since: string): string {
  const match = since.match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!match) {
    throw new Error(
      `Invalid --since value "${since}". Use format: 30s, 5m, 1h, 2d`,
    );
  }
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const unitMap: Record<string, string> = { s: "s", m: "m", h: "h", d: "h" };
  const multiplier: Record<string, number> = { s: 1, m: 1, h: 1, d: 24 };
  return `${value * multiplier[unit]}${unitMap[unit]}`;
}

/**
 * Filter log output by category.
 * Returns only lines matching the category's keyword patterns.
 */
export function filterByCategory(
  output: string,
  category: LogCategory,
): string {
  const pattern = CATEGORY_PATTERNS[category];
  return output
    .split("\n")
    .filter((line) => pattern.test(line))
    .join("\n");
}

/**
 * Stream container logs to stdout (follow mode or one-shot).
 */
export async function streamContainerLogs(
  options: LogsOptions,
): Promise<void> {
  const docker = new DockerClient();

  const since = options.since ? parseSinceDuration(options.since) : undefined;

  if (options.follow && !options.category) {
    // Real-time streaming — pipe directly to process streams
    await docker.streamLogs({
      tail: options.tail,
      since,
      timestamps: true,
      stdout: process.stdout,
      stderr: process.stderr,
      signal: options.signal,
    });
    return;
  }

  // Buffered mode — fetch logs then optionally filter
  const result = await docker.logs({
    tail: options.tail,
    since,
    timestamps: true,
    signal: options.signal,
  });

  let output = result.stdout || result.stderr;
  if (options.category) {
    output = filterByCategory(output, options.category);
  }

  if (output.trim()) {
    process.stdout.write(output.endsWith("\n") ? output : output + "\n");
  }
}

/**
 * Read cron execution history for a specific job.
 * Reads from ~/.openclaw/cron/runs/<jobId>.jsonl
 */
export async function readCronHistory(
  openclawHome: string,
  jobId: string,
  options: { since?: string } = {},
): Promise<CronRunEntry[]> {
  const runsPath = join(openclawHome, "cron", "runs", `${jobId}.jsonl`);

  let content: string;
  try {
    content = await readFile(runsPath, "utf-8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // Check if the job ID exists at all
      const jobsPath = join(openclawHome, "cron", "jobs.json");
      try {
        const jobsContent = await readFile(jobsPath, "utf-8");
        const jobs = JSON.parse(jobsContent) as Array<{ id: string }>;
        const exists = jobs.some((j) => j.id === jobId);
        if (!exists) {
          throw new Error(`Cron job "${jobId}" not found in jobs.json`, { cause: err });
        }
      } catch (innerErr: unknown) {
        if ((innerErr as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error(
            `No cron configuration found at ${jobsPath}`,
            { cause: innerErr },
          );
        }
        throw innerErr;
      }
      return []; // Job exists but has no run history yet
    }
    throw err;
  }

  const entries: CronRunEntry[] = content
    .trim()
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const obj = JSON.parse(line) as Record<string, unknown>;
      return {
        timestamp: String(obj.timestamp ?? obj.ts ?? ""),
        jobId,
        success: Boolean(obj.success ?? obj.ok ?? !obj.error),
        durationMs: obj.durationMs != null ? Number(obj.durationMs) : undefined,
        output: obj.output != null ? String(obj.output) : undefined,
        error: obj.error != null ? String(obj.error) : undefined,
      };
    });

  // Apply --since filter if provided
  if (options.since) {
    const sinceMs = parseSinceToMs(options.since);
    const cutoff = Date.now() - sinceMs;
    return entries.filter((e) => new Date(e.timestamp).getTime() >= cutoff);
  }

  return entries;
}

/**
 * List available cron job IDs from runs directory.
 */
export async function listCronJobIds(
  openclawHome: string,
): Promise<string[]> {
  const runsDir = join(openclawHome, "cron", "runs");
  try {
    const files = await readdir(runsDir);
    return files
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => f.replace(/\.jsonl$/, ""));
  } catch {
    return [];
  }
}

/**
 * Format cron history entries for display.
 */
export function formatCronHistory(entries: CronRunEntry[]): string {
  if (entries.length === 0) {
    return "No execution history found.";
  }

  const lines = [
    `Cron job "${entries[0].jobId}" — ${entries.length} executions:`,
    "",
  ];

  for (const entry of entries) {
    const status = entry.success ? "OK" : "FAIL";
    const duration =
      entry.durationMs != null ? ` (${entry.durationMs}ms)` : "";
    const detail = entry.error
      ? ` — ${entry.error}`
      : entry.output
        ? ` — ${entry.output.slice(0, 100)}`
        : "";
    lines.push(`  ${entry.timestamp}  ${status}${duration}${detail}`);
  }

  return lines.join("\n");
}

/** Convert a duration string like "1h", "30m", "2d" to milliseconds. */
function parseSinceToMs(since: string): number {
  const match = since.match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!match) {
    throw new Error(
      `Invalid --since value "${since}". Use format: 30s, 5m, 1h, 2d`,
    );
  }
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return value * multipliers[unit];
}

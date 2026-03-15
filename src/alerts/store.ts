/**
 * Metric history store.
 *
 * Persists metric snapshots to a JSON file for trend analysis.
 * Maintains a rolling window of snapshots, pruning old entries
 * to keep the file manageable.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { MetricDataPoint, MetricSnapshot } from "./types.js";

/** Maximum number of snapshots to retain. */
const MAX_SNAPSHOTS = 1000;

/** Default history file location. */
function defaultHistoryPath(openclawHome: string): string {
  const resolved = openclawHome.replace(/^~/, process.env.HOME ?? "~");
  return join(resolved, ".clawhq", "metrics-history.json");
}

/** Stored history format. */
interface MetricsHistory {
  version: 1;
  snapshots: MetricSnapshot[];
}

/**
 * Load metric history from disk.
 */
export async function loadHistory(
  openclawHome: string,
  historyPath?: string,
): Promise<MetricSnapshot[]> {
  const path = historyPath ?? defaultHistoryPath(openclawHome);
  try {
    const raw = await readFile(path, "utf-8");
    const data = JSON.parse(raw) as MetricsHistory;
    if (data.version !== 1 || !Array.isArray(data.snapshots)) {
      return [];
    }
    return data.snapshots;
  } catch {
    return [];
  }
}

/**
 * Append a snapshot to the history and persist to disk.
 * Prunes to MAX_SNAPSHOTS oldest entries.
 */
export async function appendSnapshot(
  openclawHome: string,
  snapshot: MetricSnapshot,
  historyPath?: string,
): Promise<void> {
  const path = historyPath ?? defaultHistoryPath(openclawHome);
  const snapshots = await loadHistory(openclawHome, path);

  snapshots.push(snapshot);

  // Prune oldest if over limit
  while (snapshots.length > MAX_SNAPSHOTS) {
    snapshots.shift();
  }

  const data: MetricsHistory = { version: 1, snapshots };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Extract a time series for a specific metric from the history.
 */
export function extractTimeSeries(
  snapshots: MetricSnapshot[],
  metricName: string,
): MetricDataPoint[] {
  const points: MetricDataPoint[] = [];

  for (const snap of snapshots) {
    const value = snap.metrics[metricName];
    if (value !== undefined) {
      points.push({
        timestamp: snap.timestamp,
        value,
      });
    }
  }

  return points;
}

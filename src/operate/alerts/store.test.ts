import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendSnapshot, extractTimeSeries, loadHistory } from "./store.js";
import type { MetricSnapshot } from "./types.js";

describe("store", () => {
  let tempDir: string;
  let historyPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "clawhq-alerts-test-"));
    historyPath = join(tempDir, "metrics-history.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns empty array for non-existent history", async () => {
    const history = await loadHistory(tempDir, historyPath);
    expect(history).toEqual([]);
  });

  it("appends and loads snapshots", async () => {
    const snapshot: MetricSnapshot = {
      timestamp: "2026-03-13T11:00:00Z",
      metrics: { memory_hot_bytes: 45000, error_rate: 0 },
    };

    await appendSnapshot(tempDir, snapshot, historyPath);
    const history = await loadHistory(tempDir, historyPath);

    expect(history).toHaveLength(1);
    expect(history[0].metrics.memory_hot_bytes).toBe(45000);
  });

  it("appends multiple snapshots in order", async () => {
    const s1: MetricSnapshot = {
      timestamp: "2026-03-13T11:00:00Z",
      metrics: { memory_hot_bytes: 40000 },
    };
    const s2: MetricSnapshot = {
      timestamp: "2026-03-13T12:00:00Z",
      metrics: { memory_hot_bytes: 50000 },
    };

    await appendSnapshot(tempDir, s1, historyPath);
    await appendSnapshot(tempDir, s2, historyPath);
    const history = await loadHistory(tempDir, historyPath);

    expect(history).toHaveLength(2);
    expect(history[0].timestamp).toBe("2026-03-13T11:00:00Z");
    expect(history[1].timestamp).toBe("2026-03-13T12:00:00Z");
  });
});

describe("extractTimeSeries", () => {
  it("extracts data points for a specific metric", () => {
    const snapshots: MetricSnapshot[] = [
      { timestamp: "2026-03-10T00:00:00Z", metrics: { memory_hot_bytes: 100, error_rate: 0 } },
      { timestamp: "2026-03-11T00:00:00Z", metrics: { memory_hot_bytes: 200, error_rate: 1 } },
      { timestamp: "2026-03-12T00:00:00Z", metrics: { memory_hot_bytes: 300 } },
    ];

    const series = extractTimeSeries(snapshots, "memory_hot_bytes");
    expect(series).toHaveLength(3);
    expect(series[0].value).toBe(100);
    expect(series[2].value).toBe(300);
  });

  it("skips snapshots missing the metric", () => {
    const snapshots: MetricSnapshot[] = [
      { timestamp: "2026-03-10T00:00:00Z", metrics: { memory_hot_bytes: 100 } },
      { timestamp: "2026-03-11T00:00:00Z", metrics: { error_rate: 1 } },
      { timestamp: "2026-03-12T00:00:00Z", metrics: { memory_hot_bytes: 300 } },
    ];

    const series = extractTimeSeries(snapshots, "memory_hot_bytes");
    expect(series).toHaveLength(2);
  });

  it("returns empty array for unknown metric", () => {
    const snapshots: MetricSnapshot[] = [
      { timestamp: "2026-03-10T00:00:00Z", metrics: { memory_hot_bytes: 100 } },
    ];

    const series = extractTimeSeries(snapshots, "nonexistent");
    expect(series).toHaveLength(0);
  });
});

import { describe, expect, it } from "vitest";

import { generateAlerts } from "./predictor.js";
import type { AlertThresholds, MetricSnapshot } from "./types.js";
import { DEFAULT_THRESHOLDS } from "./types.js";

function makeSnapshots(
  metricOverrides: Record<string, number[]>,
  baseDate = "2026-03-10",
): MetricSnapshot[] {
  // Determine the number of snapshots from the longest metric array
  const lengths = Object.values(metricOverrides).map((v) => v.length);
  const count = Math.max(...lengths, 0);

  const snapshots: MetricSnapshot[] = [];
  for (let i = 0; i < count; i++) {
    const date = new Date(`${baseDate}T00:00:00Z`);
    date.setDate(date.getDate() + i);

    const metrics: Record<string, number> = {};
    for (const [key, values] of Object.entries(metricOverrides)) {
      if (i < values.length) {
        metrics[key] = values[i];
      }
    }

    snapshots.push({
      timestamp: date.toISOString(),
      metrics,
    });
  }

  return snapshots;
}

describe("generateAlerts", () => {
  it("returns empty alerts for no data", () => {
    const report = generateAlerts([]);
    expect(report.alerts).toHaveLength(0);
    expect(report.counts.critical).toBe(0);
    expect(report.counts.warning).toBe(0);
    expect(report.counts.info).toBe(0);
  });

  it("returns empty alerts for stable metrics", () => {
    const snapshots = makeSnapshots({
      memory_hot_bytes: [50000, 50000, 50000, 50000],
      memory_total_bytes: [100000, 100000, 100000, 100000],
      identity_tokens: [1000, 1000, 1000, 1000],
      error_rate: [0, 0, 0, 0],
    });
    const report = generateAlerts(snapshots);
    expect(report.alerts).toHaveLength(0);
  });

  it("generates alert for rising hot memory trend", () => {
    const snapshots = makeSnapshots({
      memory_hot_bytes: [40000, 55000, 70000],
    });
    const report = generateAlerts(snapshots);

    const memAlerts = report.alerts.filter((a) => a.category === "memory");
    expect(memAlerts.length).toBeGreaterThan(0);

    const hotAlert = memAlerts.find((a) => a.title.includes("Hot memory"));
    expect(hotAlert).toBeDefined();
    expect(hotAlert?.trend).not.toBeNull();
    expect(hotAlert?.trend?.direction).toBe("rising");
    expect(hotAlert?.remediation.length).toBeGreaterThan(0);
  });

  it("generates warning for hot memory near capacity", () => {
    const snapshots = makeSnapshots({
      memory_hot_bytes: [75000, 80000, 85000],
    });
    const thresholds: AlertThresholds = {
      ...DEFAULT_THRESHOLDS,
      memoryHotWarnBytes: 80 * 1024,
    };
    const report = generateAlerts(snapshots, thresholds);

    const nearCapAlert = report.alerts.find((a) =>
      a.title.includes("Hot memory tier") && a.category === "memory",
    );
    expect(nearCapAlert).toBeDefined();
  });

  it("generates alert for credential expiry", () => {
    const snapshots = makeSnapshots({
      credential_expiry_days: [5, 4, 3],
    });
    const report = generateAlerts(snapshots);

    const credAlerts = report.alerts.filter((a) => a.category === "credentials");
    expect(credAlerts.length).toBeGreaterThan(0);
    expect(credAlerts[0].title).toContain("expiring");
    expect(credAlerts[0].projectedTimeline).not.toBeNull();
  });

  it("generates critical alert for expired credentials", () => {
    const snapshots = makeSnapshots({
      credential_expiry_days: [2, 1, 0],
    });
    const report = generateAlerts(snapshots);

    const credAlerts = report.alerts.filter((a) => a.category === "credentials");
    const expired = credAlerts.find((a) => a.severity === "critical");
    expect(expired).toBeDefined();
    expect(expired?.title).toContain("expired");
  });

  it("generates alert for rising error rate", () => {
    const snapshots = makeSnapshots({
      error_rate: [0, 2, 4],
    });
    const report = generateAlerts(snapshots);

    const errorAlerts = report.alerts.filter((a) => a.category === "errors");
    expect(errorAlerts.length).toBeGreaterThan(0);
    expect(errorAlerts.some((a) => a.title.includes("Error rate"))).toBe(true);
  });

  it("generates alert for identity token growth approaching limit", () => {
    const snapshots = makeSnapshots({
      identity_tokens: [5000, 6000, 7000],
    });
    const thresholds: AlertThresholds = {
      ...DEFAULT_THRESHOLDS,
      identityTokenWarn: 8000,
    };
    const report = generateAlerts(snapshots, thresholds);

    const qualityAlerts = report.alerts.filter((a) => a.category === "quality");
    expect(qualityAlerts.length).toBeGreaterThan(0);
    expect(qualityAlerts.some((a) => a.title.includes("Identity token bloat"))).toBe(true);
  });

  it("includes projected timeline in alerts", () => {
    const snapshots = makeSnapshots({
      memory_hot_bytes: [40000, 55000, 70000],
    });
    const report = generateAlerts(snapshots);

    const alertsWithTimeline = report.alerts.filter((a) => a.projectedTimeline !== null);
    expect(alertsWithTimeline.length).toBeGreaterThan(0);
  });

  it("deduplicates alerts by category and title", () => {
    // Providing data that triggers both trend + threshold alerts for same metric
    const snapshots = makeSnapshots({
      memory_hot_bytes: [75000, 80000, 85000],
    });
    const thresholds: AlertThresholds = {
      ...DEFAULT_THRESHOLDS,
      memoryHotWarnBytes: 80 * 1024,
    };
    const report = generateAlerts(snapshots, thresholds);

    // Check no duplicate title+category combos
    const keys = report.alerts.map((a) => `${a.category}:${a.title}`);
    const uniqueKeys = new Set(keys);
    expect(keys.length).toBe(uniqueKeys.size);
  });

  it("sorts alerts by severity (critical first)", () => {
    const snapshots = makeSnapshots({
      credential_expiry_days: [2, 1, 0],
      memory_hot_bytes: [40000, 55000, 70000],
    });
    const report = generateAlerts(snapshots);

    if (report.alerts.length >= 2) {
      const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };
      for (let i = 1; i < report.alerts.length; i++) {
        const prev = SEVERITY_ORDER[report.alerts[i - 1].severity];
        const curr = SEVERITY_ORDER[report.alerts[i].severity];
        expect(curr).toBeGreaterThanOrEqual(prev);
      }
    }
  });

  it("includes metric summary in report", () => {
    const snapshots = makeSnapshots({
      memory_hot_bytes: [40000, 55000, 70000],
      error_rate: [0, 0, 0],
    });
    const report = generateAlerts(snapshots);

    expect(report.metricSummary.tracked).toBeGreaterThan(0);
    expect(report.metricSummary.trending).toBeGreaterThanOrEqual(0);
    expect(report.metricSummary.stable).toBeGreaterThanOrEqual(0);
  });
});

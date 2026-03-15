import { describe, expect, it } from "vitest";

import { analyzeTrend, linearRegression, projectDaysToLimit } from "./analyzer.js";
import type { MetricDataPoint, TrendAnalysis } from "./types.js";
import { DEFAULT_THRESHOLDS } from "./types.js";

describe("linearRegression", () => {
  it("returns zero slope for single point", () => {
    const result = linearRegression([
      { timestamp: "2026-03-10T00:00:00Z", value: 100 },
    ]);
    expect(result.slope).toBe(0);
    expect(result.intercept).toBe(100);
    expect(result.rSquared).toBe(0);
  });

  it("returns zero slope for constant values", () => {
    const points: MetricDataPoint[] = [
      { timestamp: "2026-03-10T00:00:00Z", value: 50 },
      { timestamp: "2026-03-11T00:00:00Z", value: 50 },
      { timestamp: "2026-03-12T00:00:00Z", value: 50 },
    ];
    const result = linearRegression(points);
    expect(result.slope).toBeCloseTo(0, 10);
  });

  it("computes positive slope for rising data", () => {
    const points: MetricDataPoint[] = [
      { timestamp: "2026-03-10T00:00:00Z", value: 100 },
      { timestamp: "2026-03-11T00:00:00Z", value: 200 },
      { timestamp: "2026-03-12T00:00:00Z", value: 300 },
    ];
    const result = linearRegression(points);
    expect(result.slope).toBeGreaterThan(0);
    expect(result.rSquared).toBeCloseTo(1, 5);
  });

  it("computes negative slope for falling data", () => {
    const points: MetricDataPoint[] = [
      { timestamp: "2026-03-10T00:00:00Z", value: 300 },
      { timestamp: "2026-03-11T00:00:00Z", value: 200 },
      { timestamp: "2026-03-12T00:00:00Z", value: 100 },
    ];
    const result = linearRegression(points);
    expect(result.slope).toBeLessThan(0);
    expect(result.rSquared).toBeCloseTo(1, 5);
  });

  it("returns lower rSquared for noisy data", () => {
    const points: MetricDataPoint[] = [
      { timestamp: "2026-03-10T00:00:00Z", value: 100 },
      { timestamp: "2026-03-11T00:00:00Z", value: 300 },
      { timestamp: "2026-03-12T00:00:00Z", value: 150 },
      { timestamp: "2026-03-13T00:00:00Z", value: 250 },
    ];
    const result = linearRegression(points);
    expect(result.rSquared).toBeLessThan(0.8);
  });
});

describe("analyzeTrend", () => {
  it("returns null with insufficient data points", () => {
    const points: MetricDataPoint[] = [
      { timestamp: "2026-03-10T00:00:00Z", value: 100 },
    ];
    const result = analyzeTrend("test_metric", points);
    expect(result).toBeNull();
  });

  it("detects rising trend", () => {
    const points: MetricDataPoint[] = [
      { timestamp: "2026-03-10T00:00:00Z", value: 1000 },
      { timestamp: "2026-03-11T00:00:00Z", value: 2000 },
      { timestamp: "2026-03-12T00:00:00Z", value: 3000 },
    ];
    const result = analyzeTrend("test_metric", points);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("rising");
    expect(result?.slopePerDay).toBeCloseTo(1000, -1);
    expect(result?.currentValue).toBe(3000);
  });

  it("detects falling trend", () => {
    const points: MetricDataPoint[] = [
      { timestamp: "2026-03-10T00:00:00Z", value: 3000 },
      { timestamp: "2026-03-11T00:00:00Z", value: 2000 },
      { timestamp: "2026-03-12T00:00:00Z", value: 1000 },
    ];
    const result = analyzeTrend("test_metric", points);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("falling");
    expect(result?.slopePerDay).toBeLessThan(0);
  });

  it("detects stable trend for constant values", () => {
    const points: MetricDataPoint[] = [
      { timestamp: "2026-03-10T00:00:00Z", value: 500 },
      { timestamp: "2026-03-11T00:00:00Z", value: 500 },
      { timestamp: "2026-03-12T00:00:00Z", value: 500 },
    ];
    const result = analyzeTrend("test_metric", points);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("stable");
  });

  it("respects custom thresholds for minimum data points", () => {
    const points: MetricDataPoint[] = [
      { timestamp: "2026-03-10T00:00:00Z", value: 100 },
      { timestamp: "2026-03-11T00:00:00Z", value: 200 },
      { timestamp: "2026-03-12T00:00:00Z", value: 300 },
    ];
    const result = analyzeTrend("test_metric", points, {
      ...DEFAULT_THRESHOLDS,
      minDataPoints: 5,
    });
    expect(result).toBeNull();
  });

  it("sorts unsorted data before analysis", () => {
    const points: MetricDataPoint[] = [
      { timestamp: "2026-03-12T00:00:00Z", value: 300 },
      { timestamp: "2026-03-10T00:00:00Z", value: 100 },
      { timestamp: "2026-03-11T00:00:00Z", value: 200 },
    ];
    const result = analyzeTrend("test_metric", points);
    expect(result).not.toBeNull();
    expect(result?.currentValue).toBe(300);
    expect(result?.direction).toBe("rising");
  });
});

describe("projectDaysToLimit", () => {
  it("returns null for stable trend", () => {
    const trend: TrendAnalysis = {
      metric: "test",
      direction: "stable",
      slopePerDay: 0,
      rSquared: 0.9,
      currentValue: 100,
      dataPoints: 5,
    };
    expect(projectDaysToLimit(trend, 1000)).toBeNull();
  });

  it("returns null for falling trend", () => {
    const trend: TrendAnalysis = {
      metric: "test",
      direction: "falling",
      slopePerDay: -100,
      rSquared: 0.9,
      currentValue: 500,
      dataPoints: 5,
    };
    expect(projectDaysToLimit(trend, 1000)).toBeNull();
  });

  it("projects days to limit for rising trend", () => {
    const trend: TrendAnalysis = {
      metric: "test",
      direction: "rising",
      slopePerDay: 100,
      rSquared: 0.9,
      currentValue: 700,
      dataPoints: 5,
    };
    const days = projectDaysToLimit(trend, 1000);
    expect(days).toBe(3); // (1000 - 700) / 100 = 3
  });

  it("returns 0 when already at limit", () => {
    const trend: TrendAnalysis = {
      metric: "test",
      direction: "rising",
      slopePerDay: 100,
      rSquared: 0.9,
      currentValue: 1200,
      dataPoints: 5,
    };
    expect(projectDaysToLimit(trend, 1000)).toBe(0);
  });
});

/**
 * Trend analyzer.
 *
 * Performs linear regression on metric time series to detect trends:
 * rising, falling, or stable. Uses ordinary least squares (OLS) for
 * simplicity and robustness with small data sets.
 */

import type { AlertThresholds, MetricDataPoint, TrendAnalysis, TrendDirection } from "./types.js";
import { DEFAULT_THRESHOLDS } from "./types.js";

/**
 * Perform linear regression on a set of data points.
 * Returns slope (units per millisecond), intercept, and R-squared.
 */
export function linearRegression(points: MetricDataPoint[]): {
  slope: number;
  intercept: number;
  rSquared: number;
} {
  if (points.length < 2) {
    return { slope: 0, intercept: points[0]?.value ?? 0, rSquared: 0 };
  }

  const n = points.length;
  const times = points.map((p) => new Date(p.timestamp).getTime());
  const values = points.map((p) => p.value);

  // Normalize times relative to first point to avoid floating-point issues
  const t0 = times[0];
  const xs = times.map((t) => t - t0);

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += values[i];
    sumXY += xs[i] * values[i];
    sumX2 += xs[i] * xs[i];
  }

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) {
    return { slope: 0, intercept: sumY / n, rSquared: 0 };
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  // R-squared
  const meanY = sumY / n;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const predicted = intercept + slope * xs[i];
    ssRes += (values[i] - predicted) ** 2;
    ssTot += (values[i] - meanY) ** 2;
  }

  const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  return { slope, intercept, rSquared };
}

const MS_PER_DAY = 86_400_000;

/**
 * Analyze a time series of data points for a single metric.
 * Returns trend direction, slope per day, and fit quality.
 */
export function analyzeTrend(
  metric: string,
  points: MetricDataPoint[],
  thresholds: AlertThresholds = DEFAULT_THRESHOLDS,
): TrendAnalysis | null {
  if (points.length < thresholds.minDataPoints) {
    return null;
  }

  // Sort by timestamp ascending
  const sorted = [...points].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const { slope, rSquared } = linearRegression(sorted);

  // Convert slope from per-millisecond to per-day
  const slopePerDay = slope * MS_PER_DAY;

  const currentValue = sorted[sorted.length - 1].value;

  let direction: TrendDirection = "stable";
  if (rSquared >= thresholds.minTrendRSquared) {
    // Determine if the slope is meaningful relative to the current value
    const relativeRate = currentValue !== 0
      ? Math.abs(slopePerDay) / currentValue
      : Math.abs(slopePerDay) > 0 ? 1 : 0;

    // Consider meaningful if changing by more than 1% per day, or absolute slope > 0.5
    if (relativeRate > 0.01 || Math.abs(slopePerDay) > 0.5) {
      direction = slopePerDay > 0 ? "rising" : "falling";
    }
  }

  return {
    metric,
    direction,
    slopePerDay,
    rSquared,
    currentValue,
    dataPoints: sorted.length,
  };
}

/**
 * Given a trend, project how many days until a limit is reached.
 * Returns null if the trend is not rising or the limit won't be reached.
 */
export function projectDaysToLimit(
  trend: TrendAnalysis,
  limit: number,
): number | null {
  if (trend.direction !== "rising" || trend.slopePerDay <= 0) {
    return null;
  }

  const remaining = limit - trend.currentValue;
  if (remaining <= 0) {
    return 0; // Already at or over limit
  }

  const days = remaining / trend.slopePerDay;
  return Math.max(0, Math.round(days));
}

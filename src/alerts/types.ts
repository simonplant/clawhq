/**
 * Predictive health alert types.
 *
 * Defines metric snapshots, trend analysis, and alert structures for
 * proactive health monitoring. Metrics are collected over time and
 * analyzed for trends that predict future problems.
 */

// --- Metric types ---

export type MetricName =
  | "disk_usage_bytes"
  | "memory_hot_bytes"
  | "memory_warm_bytes"
  | "memory_cold_bytes"
  | "memory_total_bytes"
  | "memory_total_entries"
  | "identity_tokens"
  | "error_rate"
  | "credential_expiry_days"
  | "egress_bytes"
  | "stale_entries";

/** A single timestamped metric data point. */
export interface MetricDataPoint {
  timestamp: string;
  value: number;
}

/** A snapshot of all tracked metrics at a point in time. */
export interface MetricSnapshot {
  timestamp: string;
  metrics: Record<string, number>;
}

// --- Trend analysis ---

export type TrendDirection = "rising" | "falling" | "stable";

/** Result of linear regression on a metric time series. */
export interface TrendAnalysis {
  metric: string;
  direction: TrendDirection;
  /** Slope: units per day (positive = rising). */
  slopePerDay: number;
  /** R-squared: 0-1, how well the line fits. */
  rSquared: number;
  /** Current value (most recent data point). */
  currentValue: number;
  /** Number of data points used in the analysis. */
  dataPoints: number;
}

// --- Alerts ---

export type AlertSeverity = "info" | "warning" | "critical";

export type AlertCategory =
  | "disk"
  | "memory"
  | "credentials"
  | "errors"
  | "egress"
  | "quality";

export interface PredictiveAlert {
  id: string;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  message: string;
  /** Projected timeline in human-readable form (e.g., "~3 days"). */
  projectedTimeline: string | null;
  /** Available remediation steps. */
  remediation: string[];
  /** The trend that triggered this alert. */
  trend: TrendAnalysis | null;
  /** ISO timestamp when this alert was generated. */
  generatedAt: string;
}

/** Full alert report with all current and predicted alerts. */
export interface AlertReport {
  timestamp: string;
  alerts: PredictiveAlert[];
  counts: Record<AlertSeverity, number>;
  metricSummary: {
    tracked: number;
    trending: number;
    stable: number;
  };
}

// --- Thresholds ---

/** Configurable thresholds for alert generation. */
export interface AlertThresholds {
  /** Disk usage percentage that triggers a warning (0-1). */
  diskWarnPercent: number;
  /** Disk usage percentage that triggers critical (0-1). */
  diskCriticalPercent: number;
  /** Memory hot tier size that triggers warning (bytes). */
  memoryHotWarnBytes: number;
  /** Total memory size that triggers warning (bytes). */
  memoryTotalWarnBytes: number;
  /** Identity token count that triggers warning. */
  identityTokenWarn: number;
  /** Credential expiry warning lead time (days). */
  credentialExpiryWarnDays: number;
  /** Error rate per hour that triggers warning. */
  errorRateWarnPerHour: number;
  /** Minimum R-squared to consider a trend significant. */
  minTrendRSquared: number;
  /** Minimum data points to compute a trend. */
  minDataPoints: number;
}

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  diskWarnPercent: 0.8,
  diskCriticalPercent: 0.95,
  memoryHotWarnBytes: 80 * 1024, // 80KB (hot max is 100KB)
  memoryTotalWarnBytes: 500 * 1024, // 500KB
  identityTokenWarn: 8000,
  credentialExpiryWarnDays: 7,
  errorRateWarnPerHour: 5,
  minTrendRSquared: 0.6,
  minDataPoints: 3,
};

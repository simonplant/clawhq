/**
 * Predictive health alerts module.
 *
 * Public API for collecting metrics, analyzing trends, generating
 * predictive alerts, and formatting output.
 */

export type {
  AlertCategory,
  AlertReport,
  AlertSeverity,
  AlertThresholds,
  MetricDataPoint,
  MetricSnapshot,
  PredictiveAlert,
  TrendAnalysis,
  TrendDirection,
} from "./types.js";
export { DEFAULT_THRESHOLDS } from "./types.js";

export { analyzeTrend, linearRegression, projectDaysToLimit } from "./analyzer.js";
export { collectMetrics } from "./collector.js";
export { formatAlertJson, formatAlertSummary, formatAlertTable } from "./format.js";
export { generateAlerts } from "./predictor.js";
export { appendSnapshot, extractTimeSeries, loadHistory } from "./store.js";

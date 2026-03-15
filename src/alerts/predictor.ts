/**
 * Predictive alert generator.
 *
 * Analyzes metric trends and current values to generate predictive
 * health alerts. Combines trend analysis with threshold checks to
 * produce actionable alerts with projected timelines.
 */

import { analyzeTrend, projectDaysToLimit } from "./analyzer.js";
import { extractTimeSeries } from "./store.js";
import type {
  AlertReport,
  AlertSeverity,
  AlertThresholds,
  MetricSnapshot,
  PredictiveAlert,
} from "./types.js";
import { DEFAULT_THRESHOLDS } from "./types.js";

let alertCounter = 0;

function nextAlertId(): string {
  return `alert-${Date.now()}-${++alertCounter}`;
}

function formatDays(days: number): string {
  if (days === 0) return "now";
  if (days === 1) return "~1 day";
  if (days <= 7) return `~${days} days`;
  if (days <= 30) return `~${Math.round(days / 7)} weeks`;
  return `~${Math.round(days / 30)} months`;
}

/**
 * Check memory growth trends and generate alerts.
 */
function checkMemoryTrends(
  snapshots: MetricSnapshot[],
  thresholds: AlertThresholds,
  now: string,
): PredictiveAlert[] {
  const alerts: PredictiveAlert[] = [];

  // Hot tier trend
  const hotPoints = extractTimeSeries(snapshots, "memory_hot_bytes");
  const hotTrend = analyzeTrend("memory_hot_bytes", hotPoints, thresholds);

  if (hotTrend && hotTrend.direction === "rising") {
    const daysToLimit = projectDaysToLimit(hotTrend, thresholds.memoryHotWarnBytes);
    const severity: AlertSeverity =
      daysToLimit !== null && daysToLimit <= 3 ? "critical" :
      daysToLimit !== null && daysToLimit <= 7 ? "warning" : "info";

    alerts.push({
      id: nextAlertId(),
      severity,
      category: "memory",
      title: "Hot memory tier growing",
      message: daysToLimit !== null
        ? `Hot memory tier will reach capacity in ${formatDays(daysToLimit)} at current rate (${Math.round(hotTrend.slopePerDay)} bytes/day).`
        : `Hot memory tier is growing at ${Math.round(hotTrend.slopePerDay)} bytes/day.`,
      projectedTimeline: daysToLimit !== null ? formatDays(daysToLimit) : null,
      remediation: [
        "Run tier transitions to move old entries to warm storage",
        "Review hot tier entries for stale data",
        "Adjust tier policy thresholds if appropriate",
      ],
      trend: hotTrend,
      generatedAt: now,
    });
  }

  // Current hot tier over threshold (no trend needed)
  if (hotPoints.length > 0) {
    const currentHot = hotPoints[hotPoints.length - 1].value;
    if (currentHot >= thresholds.memoryHotWarnBytes) {
      alerts.push({
        id: nextAlertId(),
        severity: "warning",
        category: "memory",
        title: "Hot memory tier near capacity",
        message: `Hot memory tier at ${Math.round(currentHot / 1024)}KB (warn threshold: ${Math.round(thresholds.memoryHotWarnBytes / 1024)}KB).`,
        projectedTimeline: null,
        remediation: [
          "Run `clawhq doctor --fix` to trigger tier transitions",
          "Review and prune hot tier entries",
        ],
        trend: hotTrend,
        generatedAt: now,
      });
    }
  }

  // Total memory trend
  const totalPoints = extractTimeSeries(snapshots, "memory_total_bytes");
  const totalTrend = analyzeTrend("memory_total_bytes", totalPoints, thresholds);

  if (totalTrend && totalTrend.direction === "rising") {
    const daysToLimit = projectDaysToLimit(totalTrend, thresholds.memoryTotalWarnBytes);

    if (daysToLimit !== null && daysToLimit <= 30) {
      alerts.push({
        id: nextAlertId(),
        severity: daysToLimit <= 7 ? "warning" : "info",
        category: "memory",
        title: "Total memory growing",
        message: `Total memory will reach ${Math.round(thresholds.memoryTotalWarnBytes / 1024)}KB in ${formatDays(daysToLimit)} at current rate.`,
        projectedTimeline: formatDays(daysToLimit),
        remediation: [
          "Run tier transitions to archive and compress old memories",
          "Review memory retention policy",
        ],
        trend: totalTrend,
        generatedAt: now,
      });
    }
  }

  return alerts;
}

/**
 * Check identity token growth trends.
 */
function checkIdentityTrends(
  snapshots: MetricSnapshot[],
  thresholds: AlertThresholds,
  now: string,
): PredictiveAlert[] {
  const alerts: PredictiveAlert[] = [];

  const tokenPoints = extractTimeSeries(snapshots, "identity_tokens");
  const tokenTrend = analyzeTrend("identity_tokens", tokenPoints, thresholds);

  if (tokenTrend && tokenTrend.direction === "rising") {
    const daysToLimit = projectDaysToLimit(tokenTrend, thresholds.identityTokenWarn);

    if (daysToLimit !== null && daysToLimit <= 30) {
      alerts.push({
        id: nextAlertId(),
        severity: daysToLimit <= 7 ? "warning" : "info",
        category: "quality",
        title: "Identity token bloat detected",
        message: `Identity files will reach ${thresholds.identityTokenWarn} tokens in ${formatDays(daysToLimit)}. Bloated identity hurts response quality.`,
        projectedTimeline: formatDays(daysToLimit),
        remediation: [
          "Review and trim identity files",
          "Remove redundant instructions",
          "Consider splitting into focused profiles",
        ],
        trend: tokenTrend,
        generatedAt: now,
      });
    }
  }

  // Current identity over threshold
  if (tokenPoints.length > 0) {
    const currentTokens = tokenPoints[tokenPoints.length - 1].value;
    if (currentTokens >= thresholds.identityTokenWarn) {
      alerts.push({
        id: nextAlertId(),
        severity: "warning",
        category: "quality",
        title: "Identity files oversized",
        message: `Identity files at ~${currentTokens} tokens (warn: ${thresholds.identityTokenWarn}). This may degrade response quality.`,
        projectedTimeline: null,
        remediation: [
          "Audit identity files for redundant content",
          "Move reference data to memory tiers",
          "Split large identity files into focused sections",
        ],
        trend: tokenTrend,
        generatedAt: now,
      });
    }
  }

  return alerts;
}

/**
 * Check credential expiry.
 */
function checkCredentialExpiry(
  snapshots: MetricSnapshot[],
  thresholds: AlertThresholds,
  now: string,
): PredictiveAlert[] {
  const alerts: PredictiveAlert[] = [];

  const expiryPoints = extractTimeSeries(snapshots, "credential_expiry_days");
  if (expiryPoints.length === 0) return alerts;

  const latestExpiry = expiryPoints[expiryPoints.length - 1].value;

  if (latestExpiry <= 0) {
    alerts.push({
      id: nextAlertId(),
      severity: "critical",
      category: "credentials",
      title: "Credentials expired",
      message: "One or more integration credentials have expired.",
      projectedTimeline: "now",
      remediation: [
        "Run `clawhq creds` to identify expired credentials",
        "Rotate affected API keys immediately",
        "Update .env file with new credentials",
      ],
      trend: null,
      generatedAt: now,
    });
  } else if (latestExpiry <= thresholds.credentialExpiryWarnDays) {
    alerts.push({
      id: nextAlertId(),
      severity: "warning",
      category: "credentials",
      title: "Credentials expiring soon",
      message: `Credentials will expire in ${formatDays(latestExpiry)}.`,
      projectedTimeline: formatDays(latestExpiry),
      remediation: [
        "Run `clawhq creds` to check credential status",
        "Proactively rotate API keys before expiry",
      ],
      trend: null,
      generatedAt: now,
    });
  }

  return alerts;
}

/**
 * Check error rate trends.
 */
function checkErrorTrends(
  snapshots: MetricSnapshot[],
  thresholds: AlertThresholds,
  now: string,
): PredictiveAlert[] {
  const alerts: PredictiveAlert[] = [];

  const errorPoints = extractTimeSeries(snapshots, "error_rate");
  const errorTrend = analyzeTrend("error_rate", errorPoints, thresholds);

  if (errorTrend && errorTrend.direction === "rising") {
    alerts.push({
      id: nextAlertId(),
      severity: errorTrend.currentValue >= thresholds.errorRateWarnPerHour ? "critical" : "warning",
      category: "errors",
      title: "Error rate increasing",
      message: `Integration error rate is rising (${errorTrend.currentValue} failing, +${errorTrend.slopePerDay.toFixed(1)}/day).`,
      projectedTimeline: null,
      remediation: [
        "Run `clawhq doctor` to diagnose integration issues",
        "Check credential validity with `clawhq creds`",
        "Review agent logs with `clawhq logs --category error`",
      ],
      trend: errorTrend,
      generatedAt: now,
    });
  }

  // Current error rate above threshold
  if (errorPoints.length > 0) {
    const current = errorPoints[errorPoints.length - 1].value;
    if (current >= thresholds.errorRateWarnPerHour) {
      alerts.push({
        id: nextAlertId(),
        severity: "critical",
        category: "errors",
        title: "High error rate",
        message: `${current} integrations currently failing or expired.`,
        projectedTimeline: null,
        remediation: [
          "Run `clawhq doctor --fix` for auto-remediation",
          "Check integration health with `clawhq status`",
        ],
        trend: errorTrend,
        generatedAt: now,
      });
    }
  }

  // Stale entries
  const stalePoints = extractTimeSeries(snapshots, "stale_entries");
  const staleTrend = analyzeTrend("stale_entries", stalePoints, thresholds);

  if (staleTrend && staleTrend.direction === "rising" && staleTrend.currentValue > 0) {
    alerts.push({
      id: nextAlertId(),
      severity: "info",
      category: "memory",
      title: "Stale memory entries accumulating",
      message: `${staleTrend.currentValue} stale entries (30+ days), growing at ${staleTrend.slopePerDay.toFixed(1)}/day.`,
      projectedTimeline: null,
      remediation: [
        "Run tier transitions to archive stale entries",
        "Review memory retention policy",
      ],
      trend: staleTrend,
      generatedAt: now,
    });
  }

  return alerts;
}

/**
 * Deduplicate alerts — keep highest severity per category+title.
 */
function deduplicateAlerts(alerts: PredictiveAlert[]): PredictiveAlert[] {
  const SEVERITY_ORDER: Record<AlertSeverity, number> = {
    critical: 3,
    warning: 2,
    info: 1,
  };

  const byKey = new Map<string, PredictiveAlert>();
  for (const alert of alerts) {
    const key = `${alert.category}:${alert.title}`;
    const existing = byKey.get(key);
    if (!existing || SEVERITY_ORDER[alert.severity] > SEVERITY_ORDER[existing.severity]) {
      byKey.set(key, alert);
    }
  }

  return [...byKey.values()];
}

/**
 * Generate a full alert report from metric history.
 */
export function generateAlerts(
  snapshots: MetricSnapshot[],
  thresholds: AlertThresholds = DEFAULT_THRESHOLDS,
): AlertReport {
  const now = new Date().toISOString();

  const rawAlerts = [
    ...checkMemoryTrends(snapshots, thresholds, now),
    ...checkIdentityTrends(snapshots, thresholds, now),
    ...checkCredentialExpiry(snapshots, thresholds, now),
    ...checkErrorTrends(snapshots, thresholds, now),
  ];

  const alerts = deduplicateAlerts(rawAlerts);

  // Sort by severity (critical first), then by category
  const SEVERITY_ORDER: Record<AlertSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  alerts.sort((a, b) => {
    const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return a.category.localeCompare(b.category);
  });

  const counts: Record<AlertSeverity, number> = { critical: 0, warning: 0, info: 0 };
  for (const alert of alerts) {
    counts[alert.severity]++;
  }

  // Count tracked metrics and trends
  const trackedMetrics = new Set<string>();
  let trendingCount = 0;

  const metricsToCheck = [
    "memory_hot_bytes",
    "memory_total_bytes",
    "identity_tokens",
    "credential_expiry_days",
    "error_rate",
    "stale_entries",
  ];

  for (const metric of metricsToCheck) {
    const points = extractTimeSeries(snapshots, metric);
    if (points.length > 0) {
      trackedMetrics.add(metric);
      const trend = analyzeTrend(metric, points, thresholds);
      if (trend && trend.direction !== "stable") {
        trendingCount++;
      }
    }
  }

  return {
    timestamp: now,
    alerts,
    counts,
    metricSummary: {
      tracked: trackedMetrics.size,
      trending: trendingCount,
      stable: trackedMetrics.size - trendingCount,
    },
  };
}

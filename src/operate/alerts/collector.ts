/**
 * Metric collector.
 *
 * Extracts a MetricSnapshot from a StatusReport, converting dashboard
 * data into flat numeric metrics suitable for trend analysis.
 */

import type { StatusReport } from "../status/types.js";

import type { MetricSnapshot } from "./types.js";

/**
 * Extract a metric snapshot from a status report.
 */
export function collectMetrics(report: StatusReport): MetricSnapshot {
  const metrics: Record<string, number> = {};

  // Workspace disk/memory metrics
  metrics.memory_total_bytes = report.workspace.totalMemoryBytes;
  metrics.identity_tokens = report.workspace.totalIdentityTokens;

  for (const tier of report.workspace.memoryTiers) {
    const key = `memory_${tier.tier}_bytes`;
    metrics[key] = tier.sizeBytes;
  }

  // Structured memory metrics
  if (report.structuredMemory) {
    metrics.memory_total_entries = report.structuredMemory.totalEntries;
    metrics.stale_entries = report.structuredMemory.staleEntriesCount;

    for (const tier of report.structuredMemory.tiers) {
      metrics[`structured_${tier.name}_entries`] = tier.entryCount;
      metrics[`structured_${tier.name}_bytes`] = tier.sizeBytes;
    }
  }

  // Egress metrics
  metrics.egress_bytes = report.egress.today.bytes;

  // Integration health — count failing/expired as error rate proxy
  const failingCount =
    report.integrations.counts.failing +
    report.integrations.counts.expired +
    report.integrations.counts.error;
  metrics.error_rate = failingCount;

  // Credential expiry — count days until nearest expiry if available
  // (We use integration status as a proxy: expired = 0 days)
  const hasExpired = report.integrations.counts.expired > 0;
  if (hasExpired) {
    metrics.credential_expiry_days = 0;
  }

  return {
    timestamp: report.timestamp,
    metrics,
  };
}

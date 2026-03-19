/**
 * Daily digest generation and delivery.
 *
 * Produces a summary of the last 24h: uptime, alerts, recoveries,
 * resource snapshot. Delivered via configured notification channels.
 *
 * AC: "Daily digest delivered via configured notification channel"
 */

import { sendNotification } from "./notify.js";
import type {
  DigestContent,
  HealthAlert,
  NotificationChannel,
  NotifyResult,
  RecoveryResult,
  ResourceSample,
} from "./types.js";

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Build daily digest content from accumulated monitor data.
 */
export function buildDigest(
  alerts: readonly HealthAlert[],
  recoveries: readonly RecoveryResult[],
  latestSample: ResourceSample | null,
  startedAt: string,
): DigestContent {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 86_400_000);

  const todayAlerts = alerts.filter(
    (a) => new Date(a.timestamp) >= oneDayAgo,
  );
  const todayRecoveries = recoveries.filter(
    (r) => new Date(r.timestamp) >= oneDayAgo,
  );

  const uptimeMs = now.getTime() - new Date(startedAt).getTime();
  const uptimeHours = Math.floor(uptimeMs / 3_600_000);
  const uptimeMinutes = Math.floor((uptimeMs % 3_600_000) / 60_000);

  const hasErrors = todayAlerts.some((a) => a.severity === "critical");

  return {
    timestamp: now.toISOString(),
    period: {
      from: oneDayAgo.toISOString(),
      to: now.toISOString(),
    },
    summary: {
      uptime: `${uptimeHours}h ${uptimeMinutes}m`,
      alertsFired: todayAlerts.length,
      recoveriesAttempted: todayRecoveries.length,
      recoveriesSucceeded: todayRecoveries.filter((r) => r.success).length,
    },
    alerts: todayAlerts,
    recoveries: todayRecoveries,
    resourceSnapshot: latestSample,
    healthy: !hasErrors,
  };
}

/**
 * Format digest content as a human-readable text message.
 */
export function formatDigestMessage(digest: DigestContent): string {
  const status = digest.healthy ? "Healthy" : "Issues Detected";
  const lines: string[] = [
    `Agent Daily Digest — ${status}`,
    "",
    `Period: ${formatDate(digest.period.from)} to ${formatDate(digest.period.to)}`,
    `Uptime: ${digest.summary.uptime}`,
    "",
  ];

  // Summary
  if (digest.summary.alertsFired === 0 && digest.summary.recoveriesAttempted === 0) {
    lines.push("No alerts or recoveries in the last 24h. All quiet.");
  } else {
    if (digest.summary.alertsFired > 0) {
      lines.push(`Alerts: ${digest.summary.alertsFired} fired`);
    }
    if (digest.summary.recoveriesAttempted > 0) {
      lines.push(
        `Recoveries: ${digest.summary.recoveriesSucceeded}/${digest.summary.recoveriesAttempted} succeeded`,
      );
    }
  }

  // Resource snapshot
  if (digest.resourceSnapshot) {
    const r = digest.resourceSnapshot;
    lines.push("");
    lines.push("Resources:");
    lines.push(`  CPU: ${r.cpuPercent.toFixed(1)}%`);
    if (r.memoryLimitMb > 0) {
      lines.push(`  Memory: ${r.memoryMb.toFixed(0)}MB / ${r.memoryLimitMb.toFixed(0)}MB`);
    }
    lines.push(`  Disk: ${r.diskUsedPercent}% used (${r.diskFreeMb}MB free)`);
  }

  // Recent critical alerts
  const criticals = digest.alerts.filter((a) => a.severity === "critical");
  if (criticals.length > 0) {
    lines.push("");
    lines.push("Critical alerts:");
    for (const a of criticals.slice(0, 5)) {
      lines.push(`  [${formatTime(a.timestamp)}] ${a.message}`);
    }
    if (criticals.length > 5) {
      lines.push(`  ... and ${criticals.length - 5} more`);
    }
  }

  return lines.join("\n");
}

/**
 * Send daily digest via configured notification channels.
 *
 * Returns notification results. Never throws.
 */
export async function sendDigest(
  channels: readonly NotificationChannel[],
  digest: DigestContent,
): Promise<readonly NotifyResult[]> {
  const subject = digest.healthy
    ? "Agent Daily Digest — Healthy"
    : "Agent Daily Digest — Issues Detected";

  const body = formatDigestMessage(digest);
  return sendNotification(channels, subject, body);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Alert delivery system — sends Sentinel alerts to users via webhook or email.
 *
 * Supports two delivery methods:
 * - Webhook: POST JSON payload to a user-configured URL
 * - Email: Send via the Sentinel API (server-side email relay)
 *
 * Alert format includes: what changed upstream, what would break in
 * the user's config, and the recommended action.
 */

import { SENTINEL_API_BASE, SENTINEL_API_TIMEOUT_MS } from "../../config/defaults.js";

import type { AlertDeliveryResult, SentinelAlert } from "./types.js";

// ── Webhook Delivery ───────────────────────────────────────────────────────

/**
 * Deliver an alert via webhook POST.
 *
 * Sends the full alert as a JSON payload to the configured webhook URL.
 */
export async function deliverViaWebhook(
  alert: SentinelAlert,
  webhookUrl: string,
  signal?: AbortSignal,
): Promise<AlertDeliveryResult> {
  const timestamp = new Date().toISOString();
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "ClawHQ-Sentinel/1.0",
        "X-Sentinel-Alert-Id": alert.id,
        "X-Sentinel-Alert-Severity": alert.severity,
      },
      body: JSON.stringify({
        alert,
        source: "clawhq-sentinel",
        version: "1",
      }),
      signal: signal ?? AbortSignal.timeout(SENTINEL_API_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        success: false,
        method: "webhook",
        alertId: alert.id,
        error: `Webhook delivery failed: HTTP ${response.status}`,
        timestamp,
      };
    }

    return { success: true, method: "webhook", alertId: alert.id, timestamp };
  } catch (err) {
    return {
      success: false,
      method: "webhook",
      alertId: alert.id,
      error: `Webhook delivery failed: ${err instanceof Error ? err.message : String(err)}`,
      timestamp,
    };
  }
}

// ── Email Delivery ─────────────────────────────────────────────────────────

/**
 * Deliver an alert via the Sentinel email relay.
 *
 * The actual email sending is done server-side by the Sentinel API.
 * This sends the alert to the API, which queues it for email delivery.
 */
export async function deliverViaEmail(
  alert: SentinelAlert,
  email: string,
  token: string,
  signal?: AbortSignal,
): Promise<AlertDeliveryResult> {
  const timestamp = new Date().toISOString();
  try {
    const response = await fetch(`${SENTINEL_API_BASE}/alerts/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "User-Agent": "ClawHQ-Sentinel/1.0",
      },
      body: JSON.stringify({
        alert,
        email,
      }),
      signal: signal ?? AbortSignal.timeout(SENTINEL_API_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        success: false,
        method: "email",
        alertId: alert.id,
        error: `Email delivery failed: HTTP ${response.status}`,
        timestamp,
      };
    }

    return { success: true, method: "email", alertId: alert.id, timestamp };
  } catch (err) {
    return {
      success: false,
      method: "email",
      alertId: alert.id,
      error: `Email delivery failed: ${err instanceof Error ? err.message : String(err)}`,
      timestamp,
    };
  }
}

// ── Multi-Channel Delivery ────────────────────────────────────────────────

/**
 * Deliver an alert through all configured channels.
 *
 * Attempts webhook first (if configured), then email (if configured).
 * Returns results for each delivery attempt.
 */
export async function deliverAlert(
  alert: SentinelAlert,
  options: {
    readonly webhookUrl?: string;
    readonly alertEmail?: string;
    readonly token?: string;
    readonly signal?: AbortSignal;
  },
): Promise<readonly AlertDeliveryResult[]> {
  const results: AlertDeliveryResult[] = [];

  if (options.webhookUrl) {
    results.push(await deliverViaWebhook(alert, options.webhookUrl, options.signal));
  }

  if (options.alertEmail && options.token) {
    results.push(await deliverViaEmail(alert, options.alertEmail, options.token, options.signal));
  }

  // If no delivery methods configured, return a CLI-only result
  if (results.length === 0) {
    results.push({
      success: true,
      method: "cli",
      alertId: alert.id,
      timestamp: new Date().toISOString(),
    });
  }

  return results;
}

// ── Alert Formatting ───────────────────────────────────────────────────────

/** Format an alert as a human-readable string for CLI output. */
export function formatAlert(alert: SentinelAlert): string {
  const severityIcon = alert.severity === "critical" ? "[!]"
    : alert.severity === "warning" ? "[~]"
    : "[i]";

  const lines: string[] = [
    `${severityIcon} ${alert.title}`,
    `  Category:  ${alert.category}`,
    `  Upstream:  ${alert.upstreamChange}`,
  ];

  if (alert.configImpact) {
    lines.push(`  Impact:    ${alert.configImpact}`);
  }

  lines.push(`  Action:    ${alert.recommendedAction}`);
  lines.push(`  Commits:   ${alert.commitShas.join(", ")}`);
  lines.push(`  Date:      ${alert.createdAt}`);

  return lines.join("\n");
}

/** Format multiple alerts for CLI output. */
export function formatAlerts(alerts: readonly SentinelAlert[]): string {
  if (alerts.length === 0) {
    return "No alerts.";
  }

  const header = `Sentinel Alerts (${alerts.length})`;
  const separator = "─".repeat(60);
  const formatted = alerts.map(formatAlert).join(`\n${separator}\n`);

  return `${header}\n${separator}\n${formatted}`;
}

/** Format alerts as JSON. */
export function formatAlertsJson(alerts: readonly SentinelAlert[]): string {
  return JSON.stringify({ alerts, count: alerts.length }, null, 2);
}

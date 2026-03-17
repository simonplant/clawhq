/**
 * Notification dispatch hooks for integration with other modules.
 *
 * Each function creates the appropriate NotificationEvent and dispatches
 * it. All hooks are fire-and-forget — errors are silently caught so
 * notifications never break core functionality.
 */

import { dispatch } from "./dispatcher.js";
import type { NotificationEvent, NotificationEventType } from "./types.js";

const DEFAULT_CLAWHQ_HOME = "~/.clawhq";

function resolveClawhqHome(clawhqHome?: string): string {
  return (clawhqHome ?? DEFAULT_CLAWHQ_HOME).replace(/^~/, process.env.HOME ?? "~");
}

/**
 * Fire-and-forget dispatch. Never throws.
 */
async function safeDispatch(event: NotificationEvent, clawhqHome?: string): Promise<void> {
  try {
    await dispatch(event, resolveClawhqHome(clawhqHome));
  } catch {
    // Notification failures must never break core operations
  }
}

/**
 * Notify on critical or warning alerts from the predictive alert system.
 */
export async function notifyAlerts(
  alerts: Array<{ severity: string; title: string; message: string; generatedAt: string }>,
  clawhqHome?: string,
): Promise<void> {
  for (const alert of alerts) {
    let eventType: NotificationEventType | null = null;
    if (alert.severity === "critical") eventType = "alert.critical";
    else if (alert.severity === "warning") eventType = "alert.warning";
    if (!eventType) continue;

    await safeDispatch({
      type: eventType,
      title: alert.title,
      message: alert.message,
      timestamp: alert.generatedAt,
      meta: { severity: alert.severity },
    }, clawhqHome);
  }
}

/**
 * Notify when a new approval is enqueued.
 */
export async function notifyApprovalPending(
  entry: { id: string; category: string; description: string; createdAt: string; details?: string },
  clawhqHome?: string,
): Promise<void> {
  await safeDispatch({
    type: "approval.pending",
    title: `Approval required: ${entry.category}`,
    message: entry.description,
    timestamp: entry.createdAt,
    meta: { approvalId: entry.id, category: entry.category, details: entry.details },
  }, clawhqHome);
}

/**
 * Notify on health state transitions (degraded or recovered).
 */
export async function notifyHealthChange(
  state: "degraded" | "recovered",
  title: string,
  message: string,
  clawhqHome?: string,
): Promise<void> {
  await safeDispatch({
    type: state === "degraded" ? "health.degraded" : "health.recovered",
    title,
    message,
    timestamp: new Date().toISOString(),
  }, clawhqHome);
}

/**
 * Notify when an upstream update is available.
 */
export async function notifyUpdateAvailable(
  current: string,
  latest: { tag: string; version: string; url: string },
  clawhqHome?: string,
): Promise<void> {
  await safeDispatch({
    type: "update.available",
    title: `Update available: ${latest.version}`,
    message: `Current: ${current} → Latest: ${latest.version}`,
    timestamp: new Date().toISOString(),
    meta: { current, latestTag: latest.tag, releaseUrl: latest.url },
  }, clawhqHome);
}

/**
 * Notify when a backup fails.
 */
export async function notifyBackupFailed(
  errorMessage: string,
  errorCode?: string,
  clawhqHome?: string,
): Promise<void> {
  await safeDispatch({
    type: "backup.failed",
    title: "Backup failed",
    message: errorMessage,
    timestamp: new Date().toISOString(),
    meta: { errorCode },
  }, clawhqHome);
}

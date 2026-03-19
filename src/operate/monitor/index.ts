/**
 * Monitor daemon — background health loop with alerts, auto-recovery,
 * notifications, and daily digest.
 *
 * Proactively alerts users to agent health issues and auto-recovers
 * from common failures (container stopped, OOM).
 */

// Orchestrator
export { startMonitor } from "./monitor.js";

// Alerts
export { analyzeHealth, checkContainerHealth, collectSample } from "./alerts.js";

// Recovery
export { attemptRecovery, RecoveryTracker } from "./recovery.js";

// Notifications
export { sendNotification } from "./notify.js";

// Digest
export { buildDigest, formatDigestMessage, sendDigest } from "./digest.js";

// Formatters
export {
  formatDigestJson,
  formatDigestTable,
  formatMonitorEvent,
  formatMonitorStateJson,
  formatMonitorStateTable,
} from "./format.js";

// Types
export type {
  AlertCategory,
  AlertSeverity,
  AlertThresholds,
  DigestContent,
  EmailNotificationChannel,
  HealthAlert,
  MonitorEvent,
  MonitorEventType,
  MonitorNotifyConfig,
  MonitorOptions,
  MonitorState,
  NotificationChannel,
  NotificationChannelType,
  NotifyResult,
  RecoveryAction,
  RecoveryPolicy,
  RecoveryResult,
  ResourceSample,
  ResourceTrend,
  TelegramNotificationChannel,
  WebhookNotificationChannel,
} from "./types.js";

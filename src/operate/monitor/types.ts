/**
 * Types for the monitor daemon — health alerts, auto-recovery, notifications, and digest.
 *
 * The monitor runs as a background loop that watches agent health, fires alerts
 * before failures, auto-recovers from common issues, and delivers daily digests.
 */

// ── Notification Channel ────────────────────────────────────────────────────

/** Supported notification channel types. */
export type NotificationChannelType = "telegram" | "email" | "webhook";

/** Base notification channel config. */
export interface NotificationChannelBase {
  readonly type: NotificationChannelType;
  readonly enabled: boolean;
}

/** Telegram notification channel. */
export interface TelegramNotificationChannel extends NotificationChannelBase {
  readonly type: "telegram";
  readonly botToken: string;
  readonly chatId: string;
}

/** Email notification channel (SMTP). */
export interface EmailNotificationChannel extends NotificationChannelBase {
  readonly type: "email";
  readonly smtpHost: string;
  readonly smtpPort: number;
  readonly smtpUser: string;
  readonly smtpPass: string;
  readonly from: string;
  readonly to: string;
}

/** Webhook notification channel (generic HTTP POST). */
export interface WebhookNotificationChannel extends NotificationChannelBase {
  readonly type: "webhook";
  readonly url: string;
  readonly headers?: Record<string, string>;
}

/** Union of all notification channels. */
export type NotificationChannel =
  | TelegramNotificationChannel
  | EmailNotificationChannel
  | WebhookNotificationChannel;

/** Result of sending a notification. */
export interface NotifyResult {
  readonly channel: NotificationChannelType;
  readonly success: boolean;
  readonly error?: string;
}

// ── Alert Types ─────────────────────────────────────────────────────────────

/** Alert severity levels. */
export type AlertSeverity = "critical" | "warning" | "info";

/** Categories of health alerts. */
export type AlertCategory =
  | "container-down"
  | "container-oom"
  | "disk-critical"
  | "disk-warning"
  | "gateway-unreachable"
  | "memory-growth"
  | "cpu-sustained"
  | "credentials-expiring"
  | "recovery-attempted"
  | "recovery-succeeded"
  | "recovery-failed";

/** A fired health alert. */
export interface HealthAlert {
  readonly id: string;
  readonly timestamp: string;
  readonly severity: AlertSeverity;
  readonly category: AlertCategory;
  readonly message: string;
  readonly detail?: string;
}

// ── Resource Sample ─────────────────────────────────────────────────────────

/** A point-in-time resource measurement. */
export interface ResourceSample {
  readonly timestamp: string;
  readonly cpuPercent: number;
  readonly memoryMb: number;
  readonly memoryLimitMb: number;
  readonly diskUsedPercent: number;
  readonly diskFreeMb: number;
}

/** Trend analysis result. */
export interface ResourceTrend {
  readonly metric: "cpu" | "memory" | "disk";
  readonly slope: number;
  readonly currentValue: number;
  readonly predictedExhaustion?: string;
  readonly alert?: HealthAlert;
}

// ── Alert Thresholds ────────────────────────────────────────────────────────

/** Configurable alert thresholds. */
export interface AlertThresholds {
  /** Disk usage percent that triggers a warning (default: 80). */
  readonly diskWarningPercent?: number;
  /** Disk usage percent that triggers a critical alert (default: 90). */
  readonly diskCriticalPercent?: number;
  /** Memory usage percent that triggers a warning (default: 85). */
  readonly memoryWarningPercent?: number;
  /** Sustained CPU percent that triggers a warning (default: 90). */
  readonly cpuSustainedPercent?: number;
  /** Number of samples for trend analysis (default: 10). */
  readonly trendWindowSize?: number;
}

// ── Recovery Types ──────────────────────────────────────────────────────────

/** Recovery action types. */
export type RecoveryAction = "container-restart" | "oom-restart" | "firewall-reapply";

/** Result of a recovery attempt. */
export interface RecoveryResult {
  readonly action: RecoveryAction;
  readonly success: boolean;
  readonly timestamp: string;
  readonly message: string;
  readonly durationMs: number;
}

/** Recovery policy configuration. */
export interface RecoveryPolicy {
  /** Enable auto-recovery (default: true). */
  readonly enabled?: boolean;
  /** Max recovery attempts per hour (default: 3). */
  readonly maxAttemptsPerHour?: number;
  /** Cooldown between recovery attempts in ms (default: 60000). */
  readonly cooldownMs?: number;
}

// ── Digest Types ────────────────────────────────────────────────────────────

/** Daily digest content. */
export interface DigestContent {
  readonly timestamp: string;
  readonly period: {
    readonly from: string;
    readonly to: string;
  };
  readonly summary: {
    readonly uptime: string;
    readonly alertsFired: number;
    readonly recoveriesAttempted: number;
    readonly recoveriesSucceeded: number;
  };
  readonly alerts: readonly HealthAlert[];
  readonly recoveries: readonly RecoveryResult[];
  readonly resourceSnapshot: ResourceSample | null;
  readonly healthy: boolean;
}

// ── Monitor Options ─────────────────────────────────────────────────────────

/** Notification configuration for the monitor. */
export interface MonitorNotifyConfig {
  readonly channels: readonly NotificationChannel[];
  readonly alertsEnabled?: boolean;
  readonly digestEnabled?: boolean;
  /** Hour (0-23) to send daily digest (default: 8). */
  readonly digestHour?: number;
}

/** Memory lifecycle scheduling configuration for the monitor. */
export interface MonitorMemoryLifecycleConfig {
  /** Enable scheduled memory lifecycle runs (default: false). */
  readonly enabled: boolean;
  /** Interval between lifecycle runs in ms (default: 21600000 = 6 hours). */
  readonly intervalMs?: number;
}

/** Options for the monitor daemon. */
export interface MonitorOptions {
  readonly deployDir: string;
  /** Check interval in ms (default: 30000). */
  readonly intervalMs?: number;
  readonly thresholds?: AlertThresholds;
  readonly recovery?: RecoveryPolicy;
  readonly notify?: MonitorNotifyConfig;
  /** Memory lifecycle scheduling config. */
  readonly memoryLifecycle?: MonitorMemoryLifecycleConfig;
  readonly signal?: AbortSignal;
  /** Callback for monitor events. */
  readonly onEvent?: (event: MonitorEvent) => void;
}

// ── Monitor Events ──────────────────────────────────────────────────────────

/** Events emitted by the monitor daemon. */
export type MonitorEventType =
  | "started"
  | "tick"
  | "alert"
  | "recovery"
  | "digest"
  | "memory-lifecycle"
  | "notify"
  | "stopped"
  | "error";

/** Monitor event payload. */
export interface MonitorEvent {
  readonly type: MonitorEventType;
  readonly timestamp: string;
  readonly message: string;
  readonly data?: unknown;
}

// ── Monitor State ───────────────────────────────────────────────────────────

/** Runtime state of the monitor daemon. */
export interface MonitorState {
  readonly running: boolean;
  readonly startedAt: string | null;
  readonly lastCheck: string | null;
  readonly alertsToday: number;
  readonly recoveriesToday: number;
  readonly digestSentToday: boolean;
}

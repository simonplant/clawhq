/**
 * Types for the Sentinel upstream monitoring service.
 *
 * Sentinel provides upstream intelligence that a local cron job cannot:
 * - Pre-computing config breakage against incoming OpenClaw commits
 * - Tracking CVE impact per blueprint
 * - Alerting on skill dependency changes
 * - Aggregating anonymized health signals across the fleet
 *
 * Privacy: Sentinel receives a config fingerprint (structural metadata),
 * never config values, credentials, or content.
 */

// ── Config Fingerprint (privacy-safe) ──────────────────────────────────────

/**
 * Privacy-safe structural representation of a user's config.
 *
 * Contains only key names, types, and counts — never values, credentials,
 * or content. This is what Sentinel uses to predict breakage.
 */
export interface ConfigFingerprint {
  /** SHA256(deployDir).slice(0,16) — same as heartbeat agentId. */
  readonly agentId: string;
  /** OpenClaw version string (e.g. "0.8.6"). */
  readonly openclawVersion: string;
  /** Blueprint identifier if known (e.g. "email-manager"). */
  readonly blueprintId?: string;
  /** Top-level config keys that are set in openclaw.json. */
  readonly configKeysSet: readonly string[];
  /** Tool names that are enabled. */
  readonly toolsEnabled: readonly string[];
  /** Channel types configured (e.g. ["telegram", "signal"]). */
  readonly channelsConfigured: readonly string[];
  /** Number of cron jobs defined. */
  readonly cronJobCount: number;
  /** Whether custom identity config is set. */
  readonly hasIdentityConfig: boolean;
  /** Whether custom gateway config is set. */
  readonly hasGatewayConfig: boolean;
  /** Whether agents (multi-agent) config is set. */
  readonly hasAgentsConfig: boolean;
  /** Landmine rules that passed validation. */
  readonly landminesPassed: readonly string[];
  /** Whether the config file failed to load (missing or corrupt JSON). */
  readonly configLoadFailed?: boolean;
  /** ISO 8601 timestamp of fingerprint generation. */
  readonly generatedAt: string;
}

// ── Upstream Commit Analysis ───────────────────────────────────────────────

/** A commit from the OpenClaw upstream repository. */
export interface UpstreamCommit {
  /** Git commit SHA. */
  readonly sha: string;
  /** Commit message (first line). */
  readonly message: string;
  /** ISO 8601 timestamp. */
  readonly date: string;
  /** Author login or name. */
  readonly author: string;
  /** Files changed in this commit. */
  readonly filesChanged: readonly string[];
}

/** Classification of how an upstream change impacts config. */
export type ConfigImpactLevel = "none" | "low" | "medium" | "high" | "breaking";

/** A single config-impacting change found in an upstream commit. */
export interface ConfigImpact {
  /** Which commit introduced the change. */
  readonly commitSha: string;
  /** Affected config path (e.g. "tools.exec.host"). */
  readonly configPath: string;
  /** Nature of the change. */
  readonly changeType: "added" | "removed" | "renamed" | "default-changed" | "type-changed" | "deprecated";
  /** Impact severity. */
  readonly level: ConfigImpactLevel;
  /** Human-readable description of what changed. */
  readonly description: string;
}

/** Result of analyzing upstream commits for config impact. */
export interface UpstreamAnalysis {
  /** Commits analyzed. */
  readonly commits: readonly UpstreamCommit[];
  /** Config-impacting changes found. */
  readonly impacts: readonly ConfigImpact[];
  /** Whether any breaking changes were found. */
  readonly hasBreakingChanges: boolean;
  /** ISO 8601 timestamp of the analysis. */
  readonly analyzedAt: string;
}

// ── Breakage Prediction ───────────────────────────────────────────────────

/** A specific breakage prediction for a user's config. */
export interface BreakagePrediction {
  /** The upstream change that would cause breakage. */
  readonly impact: ConfigImpact;
  /** Config key in the user's config that would be affected. */
  readonly affectedConfigKey: string;
  /** What would break and how. */
  readonly breakageDescription: string;
  /** Recommended action to avoid breakage. */
  readonly recommendedAction: string;
}

/** Result of predicting breakage for a specific config fingerprint. */
export interface BreakageReport {
  /** Agent identifier. */
  readonly agentId: string;
  /** Number of upstream commits analyzed. */
  readonly commitsAnalyzed: number;
  /** Breakage predictions for this config. */
  readonly predictions: readonly BreakagePrediction[];
  /** Whether the user should hold off updating. */
  readonly shouldHoldUpdate: boolean;
  /** ISO 8601 timestamp. */
  readonly generatedAt: string;
}

// ── Sentinel Alerts ───────────────────────────────────────────────────────

/** Alert severity level. */
export type AlertSeverity = "info" | "warning" | "critical";

/** Alert category. */
export type AlertCategory =
  | "config-breakage"
  | "cve-advisory"
  | "dependency-change"
  | "breaking-change"
  | "upstream-release";

/** A Sentinel alert delivered to the user. */
export interface SentinelAlert {
  /** Unique alert ID. */
  readonly id: string;
  /** Alert category. */
  readonly category: AlertCategory;
  /** Severity level. */
  readonly severity: AlertSeverity;
  /** Short title. */
  readonly title: string;
  /** Detailed description of what changed upstream. */
  readonly upstreamChange: string;
  /** What would break in the user's config (if applicable). */
  readonly configImpact?: string;
  /** Recommended action. */
  readonly recommendedAction: string;
  /** Relevant upstream commit SHA(s). */
  readonly commitShas: readonly string[];
  /** ISO 8601 timestamp. */
  readonly createdAt: string;
}

/** Alert delivery method. */
export type AlertDeliveryMethod = "webhook" | "email" | "cli";

/** Result of delivering an alert. */
export interface AlertDeliveryResult {
  readonly success: boolean;
  readonly method: AlertDeliveryMethod;
  readonly alertId: string;
  readonly error?: string;
  readonly timestamp: string;
}

// ── Subscription State ────────────────────────────────────────────────────

/** Sentinel subscription tier. */
export type SentinelTier = "free" | "pro";

/** Persisted Sentinel subscription state at ~/.clawhq/cloud/sentinel.json. */
export interface SentinelSubscription {
  readonly version: 1;
  /** Whether Sentinel monitoring is active. */
  readonly active: boolean;
  /** Subscription tier. */
  readonly tier: SentinelTier;
  /** Sentinel API token (issued on signup). */
  readonly token?: string;
  /** Webhook URL for alert delivery (if configured). */
  readonly webhookUrl?: string;
  /** Email for alert delivery (if configured). */
  readonly alertEmail?: string;
  /** ISO 8601 timestamp of subscription activation. */
  readonly activatedAt?: string;
  /** ISO 8601 timestamp of last successful check. */
  readonly lastCheckAt?: string;
  /** Number of consecutive check failures. */
  readonly consecutiveFailures: number;
  /** Last error message if any. */
  readonly lastError?: string;
  /** Config fingerprint sent with last check. */
  readonly lastFingerprint?: ConfigFingerprint;
}

/** Result of a Sentinel status check. */
export interface SentinelStatusResult {
  readonly active: boolean;
  readonly tier: SentinelTier;
  readonly lastCheckAt?: string;
  readonly pendingAlerts: number;
  readonly recentAlerts: readonly SentinelAlert[];
}

/** Result of connecting to Sentinel. */
export interface SentinelConnectResult {
  readonly success: boolean;
  readonly tier: SentinelTier;
  readonly error?: string;
}

/** Result of running a Sentinel check. */
export interface SentinelCheckResult {
  readonly success: boolean;
  readonly alerts: readonly SentinelAlert[];
  readonly breakageReport?: BreakageReport;
  readonly error?: string;
  readonly timestamp: string;
}

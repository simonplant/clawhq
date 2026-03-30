/**
 * Sentinel — upstream monitoring service.
 *
 * Provides upstream intelligence that a local cron job cannot:
 * - Pre-computes config breakage against incoming OpenClaw commits
 * - Tracks CVE impact per blueprint
 * - Alerts on skill dependency changes
 *
 * Privacy: receives config fingerprints (structural metadata), never
 * config values, credentials, or content.
 */

// Types
export type {
  AlertCategory,
  AlertDeliveryMethod,
  AlertDeliveryResult,
  AlertSeverity,
  BreakagePrediction,
  BreakageReport,
  ConfigFingerprint,
  ConfigImpact,
  ConfigImpactLevel,
  SentinelAlert,
  SentinelCheckResult,
  SentinelConnectResult,
  SentinelStatusResult,
  SentinelSubscription,
  SentinelTier,
  UpstreamAnalysis,
  UpstreamCommit,
} from "./types.js";

// Fingerprint
export { generateFingerprint } from "./fingerprint.js";

// Monitor
export {
  analyzeUpstreamCommits,
  classifyConfigImpacts,
  fetchCommitDetails,
  fetchUpstreamCommits,
} from "./monitor.js";

// Analyzer
export { breakageToAlerts, predictBreakage } from "./analyzer.js";

// Alerts
export {
  deliverAlert,
  deliverViaEmail,
  deliverViaWebhook,
  formatAlert,
  formatAlerts,
  formatAlertsJson,
} from "./alerts.js";

// Subscription
export {
  connectSentinel,
  disconnectSentinel,
  getPricingUrl,
  readSentinelState,
  runSentinelCheck,
  sentinelPath,
  writeSentinelState,
} from "./subscription.js";

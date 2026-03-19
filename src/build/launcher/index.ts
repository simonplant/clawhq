/**
 * Deploy orchestration module (launcher).
 *
 * Coordinates `clawhq up / down / restart` — the full deploy lifecycle
 * with preflight checks, firewall, health verification, and progress reporting.
 */

// Orchestrator
export { deploy, restart, shutdown } from "./deploy.js";

// Preflight
export { runPreflight } from "./preflight.js";

// Firewall
export { applyFirewall, loadAllowlist, removeFirewall } from "./firewall.js";

// Health
export { smokeTest, verifyHealth } from "./health.js";

// Connect (channel setup)
export {
  connectChannel,
  pingGateway,
  sendTelegramTestMessage,
  sendWhatsAppTestMessage,
  validateTelegramToken,
  validateWhatsAppToken,
} from "./connect.js";
export type { ChannelCredentials, ChannelName } from "./connect.js";

// Types
export type {
  ConnectOptions,
  ConnectProgress,
  ConnectProgressCallback,
  ConnectResult,
  ConnectStepName,
  DeployOptions,
  DeployProgress,
  DeployResult,
  DeployStepName,
  DeployStepStatus,
  FirewallAllowEntry,
  FirewallOptions,
  FirewallResult,
  HealthVerifyOptions,
  HealthVerifyResult,
  PreflightCheckName,
  PreflightCheckResult,
  PreflightReport,
  ProgressCallback,
  ShutdownOptions,
  ShutdownResult,
  SmokeTestOptions,
  SmokeTestResult,
} from "./types.js";

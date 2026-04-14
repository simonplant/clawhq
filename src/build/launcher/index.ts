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
export {
  applyFirewall,
  buildAllowlistFromBlueprint,
  collectIntegrationDomains,
  CHAIN_NAME,
  IPSET_NAME,
  IPSET_NAME_V6,
  IPSET_REFRESH_INTERVAL_MS,
  listIpsetMembers,
  loadAllowlist,
  loadIpsetMeta,
  refreshIpset,
  removeFirewall,
  resolveDomains,
  serializeAllowlist,
  verifyFirewall,
} from "./firewall.js";
export type { FirewallRuleDescriptor } from "./firewall.js";

// Health
export { smokeTest, verifyHealth } from "./health.js";

// Connect (channel setup)
export {
  connectChannel,
  pingGateway,
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
  FirewallVerifyResult,
  IpsetMeta,
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

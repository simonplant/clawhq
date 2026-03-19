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
export { applyFirewall, removeFirewall } from "./firewall.js";

// Health
export { smokeTest, verifyHealth } from "./health.js";

// Types
export type {
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
} from "./types.js";

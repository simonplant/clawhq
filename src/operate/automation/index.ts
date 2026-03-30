/**
 * Operational automation module.
 *
 * Generates and deploys auto-update, security monitoring, and backup
 * scripts as systemd timers/services.
 */

// Generator
export { generateOpsAutomationFiles } from "./generate.js";

// Scripts
export {
  generateAutoUpdateScript,
  generateBackupScript,
  generateSecurityMonitorScript,
} from "./scripts.js";

// Systemd units
export {
  generateAutoUpdateUnits,
  generateBackupUnits,
  generateSecurityMonitorUnits,
} from "./systemd.js";

// Installer
export { getTimerLastRun, installOpsAutomation, isTimerActive } from "./install.js";

// Types
export type {
  OpsInstallOptions,
  OpsInstallResult,
  OpsScriptEntry,
} from "./types.js";

/**
 * Diagnostic engine — the "hero feature" of ClawHQ.
 *
 * Checks every known failure mode preventively:
 * - Docker daemon running
 * - OpenClaw images exist
 * - Config passes all 14 landmine rules
 * - File permissions (.env 600, identity read-only)
 * - No secrets embedded in config files
 * - Container running and healthy
 * - Port 18789 not already bound
 * - Security posture matches expected level
 */

export type {
  Check,
  CheckResult,
  CheckStatus,
  DoctorContext,
  DoctorReport,
  FixableCheck,
  FixResult,
} from "./types.js";
export { isFixable } from "./types.js";

export { DEFAULT_CHECKS, runChecks, formatTable, formatJson } from "./runner.js";
export { runFixes } from "./fix.js";

export { dockerDaemonCheck } from "./checks/docker-daemon.js";
export { openclawImagesCheck } from "./checks/openclaw-images.js";
export { configValidationCheck } from "./checks/config-validation.js";
export { filePermissionsCheck } from "./checks/file-permissions.js";
export { secretsScanCheck } from "./checks/secrets-scan.js";
export { containerHealthCheck } from "./checks/container-health.js";
export { portAvailabilityCheck } from "./checks/port-availability.js";
export { securityPostureCheck } from "./checks/security-posture.js";
export type { SecurityPostureContext } from "./checks/security-posture.js";
export { memoryHealthCheck } from "./checks/memory-health.js";

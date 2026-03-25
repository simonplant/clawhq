/**
 * Doctor diagnostics module.
 *
 * Preventive diagnostics (21 checks) with auto-fix capability.
 * The hero feature — catches every known failure mode before it hits the user.
 */

// Orchestrator
export { runDoctor, runDoctorWithFix } from "./doctor.js";

// Checks (for targeted use)
export { compareVersions, detectOpenClawVersion, runChecks } from "./checks.js";

// Auto-fix
export { runFixes } from "./fix.js";

// Formatters
export { formatDoctorJson, formatDoctorTable, formatFixTable } from "./format.js";

// Types
export type {
  DoctorCheckName,
  DoctorCheckResult,
  DoctorOptions,
  DoctorReport,
  DoctorSeverity,
  FixReport,
  FixResult,
} from "./types.js";

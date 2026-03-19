/**
 * Doctor orchestrator — runs all diagnostic checks and optional auto-fix.
 *
 * This is the main entry point for `clawhq doctor [--fix] [--json]`.
 * Coordinates checks → report → optional fix → re-verify.
 */

import { runChecks } from "./checks.js";
import { runFixes } from "./fix.js";
import type { DoctorOptions, DoctorReport, FixReport } from "./types.js";

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Run all doctor diagnostics.
 *
 * Returns a DoctorReport with individual check results and aggregate status.
 * Never throws — all errors are captured in check results.
 */
export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const checks = await runChecks(options.deployDir, options.signal);

  const passed = checks.filter((c) => c.passed);
  const errors = checks.filter((c) => !c.passed && c.severity === "error");
  const warnings = checks.filter((c) => !c.passed && c.severity === "warning");

  return {
    timestamp: new Date().toISOString(),
    checks,
    passed,
    errors,
    warnings,
    healthy: errors.length === 0,
  };
}

/**
 * Run auto-fixes for fixable issues, then re-run checks to verify.
 *
 * Returns both the fix report and the updated doctor report.
 */
export async function runDoctorWithFix(
  options: DoctorOptions,
): Promise<{ report: DoctorReport; fixReport: FixReport }> {
  // First pass — identify issues
  const initialChecks = await runChecks(options.deployDir, options.signal);

  // Run fixes
  const fixReport = await runFixes(options.deployDir, initialChecks);

  // Re-run checks to verify fixes
  const report = await runDoctor(options);

  return { report, fixReport };
}

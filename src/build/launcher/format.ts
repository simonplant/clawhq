/**
 * Deploy progress formatting.
 *
 * Displays step-by-step status for deploy, shutdown, and restart operations.
 */

import type { StepResult } from "./types.js";

const STATUS_ICONS: Record<string, string> = {
  done: "OK",
  failed: "FAIL",
  skipped: "SKIP",
  running: "...",
};

export function formatStepStart(stepNumber: number, totalSteps: number, name: string): string {
  return `[${stepNumber}/${totalSteps}] ${name}...`;
}

export function formatStepResult(stepNumber: number, totalSteps: number, step: StepResult): string {
  const icon = STATUS_ICONS[step.status] ?? step.status;
  const duration = step.durationMs >= 1000
    ? `${(step.durationMs / 1000).toFixed(1)}s`
    : `${step.durationMs}ms`;
  return `[${stepNumber}/${totalSteps}] ${icon}  ${step.name} (${duration}): ${step.message}`;
}

export function formatSummary(
  operation: string,
  steps: StepResult[],
  success: boolean,
): string {
  const lines: string[] = [];
  const totalMs = steps.reduce((sum, s) => sum + s.durationMs, 0);
  const duration = totalMs >= 1000
    ? `${(totalMs / 1000).toFixed(1)}s`
    : `${totalMs}ms`;

  lines.push("");
  if (success) {
    lines.push(`${operation} completed successfully (${duration})`);
  } else {
    const failures = steps.filter((s) => s.status === "failed");
    lines.push(`${operation} failed (${failures.length} error${failures.length > 1 ? "s" : ""})`);
    for (const f of failures) {
      lines.push(`  ${f.name}: ${f.message}`);
    }
  }
  return lines.join("\n");
}

export function formatPreflightFailures(steps: StepResult[]): string {
  const failures = steps.filter((s) => s.status === "failed");
  if (failures.length === 0) return "";

  const lines = ["Pre-flight checks failed:", ""];
  for (const f of failures) {
    lines.push(`  ${f.name}: ${f.message}`);
  }
  lines.push("");
  lines.push("Deployment aborted. Fix the issues above and retry.");
  return lines.join("\n");
}

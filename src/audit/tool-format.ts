/**
 * Tool audit trail formatters.
 *
 * Renders ToolAuditReport as:
 * - Human-readable table (default)
 * - JSON (--json)
 * - Signed export report (--export)
 * - OWASP GenAI Top 10 compliance report (--compliance)
 */

import { createHash } from "node:crypto";

import type { ToolAuditReport } from "./tool-trail.js";

// ── Helpers ────────────────────────────────────────────────────────

function pad(str: string, width: number): string {
  return str.padEnd(width);
}

function formatTimestamp(ts: string): string {
  if (!ts) return "(unknown)";
  return ts.slice(0, 19).replace("T", " ");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Table format ───────────────────────────────────────────────────

/**
 * Format the tool audit report as a human-readable table.
 */
export function formatToolAuditTable(report: ToolAuditReport): string {
  const lines: string[] = [];
  const { summary, entries } = report;

  lines.push("==================================================");
  lines.push("  TOOL EXECUTION AUDIT");
  lines.push("==================================================");

  const sinceLabel = report.since
    ? formatTimestamp(report.since)
    : "all time";
  lines.push(`  Period: ${sinceLabel} → ${formatTimestamp(report.until)}`);
  lines.push("");

  // Summary by tool
  lines.push("  TOOL SUMMARY");
  lines.push(`  ${"-".repeat(56)}`);
  lines.push(
    `  ${pad("TOOL", 18)}${pad("TOTAL", 8)}${pad("OK", 6)}${pad("ERR", 6)}${pad("AVG TIME", 10)}`,
  );
  lines.push(`  ${"-".repeat(56)}`);

  const tools = Object.entries(summary.byTool);
  if (tools.length === 0) {
    lines.push("  (no tool executions)");
  } else {
    for (const [name, ts] of tools) {
      lines.push(
        `  ${pad(name, 18)}${pad(String(ts.executions), 8)}${pad(String(ts.successes), 6)}${pad(String(ts.errors), 6)}${pad(formatDuration(ts.avgDurationMs), 10)}`,
      );
    }
    lines.push(`  ${"-".repeat(56)}`);
    lines.push(
      `  ${pad("TOTAL", 18)}${pad(String(summary.totalExecutions), 8)}${pad(String(summary.successCount), 6)}${pad(String(summary.errorCount), 6)}${pad(formatDuration(summary.avgDurationMs), 10)}`,
    );
  }
  lines.push("");

  // Detailed entries
  if (entries.length > 0) {
    lines.push("  EXECUTION LOG");
    lines.push(`  ${"-".repeat(56)}`);
    lines.push(
      `  ${pad("TIMESTAMP", 21)}${pad("TOOL", 16)}${pad("STATUS", 8)}${pad("TIME", 8)}INPUT`,
    );
    lines.push(`  ${"-".repeat(80)}`);

    for (const entry of entries) {
      const statusIcon = entry.status === "success" ? "OK" : "ERR";
      lines.push(
        `  ${pad(formatTimestamp(entry.timestamp), 21)}${pad(entry.tool, 16)}${pad(statusIcon, 8)}${pad(formatDuration(entry.durationMs), 8)}${entry.inputRedacted.slice(0, 40)}`,
      );
    }
    lines.push("");
  }

  lines.push(
    `  ${summary.totalExecutions} execution${summary.totalExecutions === 1 ? "" : "s"}, ${summary.errorCount} error${summary.errorCount === 1 ? "" : "s"}`,
  );

  return lines.join("\n");
}

// ── JSON format ────────────────────────────────────────────────────

/**
 * Format the tool audit report as JSON.
 */
export function formatToolAuditJson(report: ToolAuditReport): string {
  return JSON.stringify(report, null, 2);
}

// ── Export report ──────────────────────────────────────────────────

/**
 * Generate a signed tool audit export report.
 */
export function generateToolExportReport(report: ToolAuditReport): string {
  const lines: string[] = [];

  lines.push("CLAWHQ TOOL EXECUTION AUDIT REPORT");
  lines.push("=".repeat(40));
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Period: ${report.since ?? "all time"} → ${report.until}`);
  lines.push("");

  lines.push("SUMMARY");
  lines.push("-".repeat(40));
  lines.push(`Total executions:     ${report.summary.totalExecutions}`);
  lines.push(`Successful:           ${report.summary.successCount}`);
  lines.push(`Errors:               ${report.summary.errorCount}`);
  lines.push(`Avg duration:         ${formatDuration(report.summary.avgDurationMs)}`);
  lines.push("");

  if (Object.keys(report.summary.byTool).length > 0) {
    lines.push("BY TOOL");
    lines.push("-".repeat(40));
    for (const [name, ts] of Object.entries(report.summary.byTool)) {
      lines.push(
        `  ${name}: ${ts.executions} executions (${ts.successes} ok, ${ts.errors} err), avg ${formatDuration(ts.avgDurationMs)}`,
      );
    }
    lines.push("");
  }

  lines.push("ENTRIES");
  lines.push("-".repeat(40));
  for (const entry of report.entries) {
    lines.push(
      `  ${entry.timestamp} | ${entry.tool} | ${entry.status} | ${formatDuration(entry.durationMs)} | ${entry.inputRedacted}`,
    );
  }
  if (report.entries.length === 0) {
    lines.push("  (none)");
  }
  lines.push("");

  // Compute integrity digest
  const content = lines.join("\n");
  const digest = createHash("sha256").update(content).digest("hex");

  lines.push("INTEGRITY");
  lines.push("-".repeat(40));
  lines.push(`SHA-256: ${digest}`);

  return lines.join("\n");
}

// ── OWASP GenAI Top 10 Compliance Report ───────────────────────────

/**
 * OWASP Top 10 for LLM Applications control mapping.
 *
 * Maps tool audit data to relevant OWASP GenAI controls, providing
 * an exportable compliance report.
 */

interface ComplianceControl {
  id: string;
  name: string;
  status: "pass" | "warn" | "info";
  finding: string;
}

function assessCompliance(report: ToolAuditReport): ComplianceControl[] {
  const controls: ComplianceControl[] = [];
  const { summary, entries } = report;

  // LLM01: Prompt Injection
  // Tool audit provides visibility into what tools the agent invoked,
  // which helps detect prompt injection that triggers unexpected tool use.
  const uniqueTools = Object.keys(summary.byTool);
  controls.push({
    id: "LLM01",
    name: "Prompt Injection",
    status: "info",
    finding: `${summary.totalExecutions} tool executions across ${uniqueTools.length} distinct tool${uniqueTools.length === 1 ? "" : "s"} recorded. Review for unexpected tool invocations that may indicate prompt injection.`,
  });

  // LLM02: Insecure Output Handling
  // Tool outputs are summarized (truncated) in the audit log.
  controls.push({
    id: "LLM02",
    name: "Insecure Output Handling",
    status: summary.errorCount > 0 ? "warn" : "pass",
    finding: summary.errorCount > 0
      ? `${summary.errorCount} tool execution error${summary.errorCount === 1 ? "" : "s"} detected. Review error outputs for sensitive data leakage.`
      : "All tool executions completed successfully. Output summaries are truncated in audit log.",
  });

  // LLM05: Supply Chain Vulnerabilities
  // Track which tools are executing — unexpected tools may indicate supply chain issues.
  controls.push({
    id: "LLM05",
    name: "Supply Chain Vulnerabilities",
    status: "info",
    finding: `Tools observed: ${uniqueTools.length > 0 ? uniqueTools.join(", ") : "(none)"}. Verify all tools are from trusted sources via 'clawhq skill list'.`,
  });

  // LLM06: Sensitive Information Disclosure
  // Inputs are redacted before logging; verify no unredacted secrets appear.
  const hasRedactions = entries.some((e) => e.inputRedacted.includes("[REDACTED]"));
  controls.push({
    id: "LLM06",
    name: "Sensitive Information Disclosure",
    status: hasRedactions ? "warn" : "pass",
    finding: hasRedactions
      ? "Redacted content detected in tool inputs. Secrets were properly masked in audit log, but review the source of sensitive data in tool invocations."
      : "No sensitive patterns detected in tool inputs. Input redaction is applied automatically.",
  });

  // LLM07: Insecure Plugin Design
  // High error rates on specific tools may indicate misconfiguration.
  const highErrorTools = Object.entries(summary.byTool)
    .filter(([, ts]) => ts.executions > 0 && ts.errors / ts.executions > 0.5)
    .map(([name]) => name);
  controls.push({
    id: "LLM07",
    name: "Insecure Plugin Design",
    status: highErrorTools.length > 0 ? "warn" : "pass",
    finding: highErrorTools.length > 0
      ? `High error rate (>50%) on tools: ${highErrorTools.join(", ")}. Investigate tool configuration and input validation.`
      : "All tools operating within normal error thresholds.",
  });

  // LLM08: Excessive Agency
  // Track total tool execution volume and diversity.
  const highVolumeTools = Object.entries(summary.byTool)
    .filter(([, ts]) => ts.executions > 100)
    .map(([name, ts]) => `${name} (${ts.executions})`);
  controls.push({
    id: "LLM08",
    name: "Excessive Agency",
    status: highVolumeTools.length > 0 ? "warn" : "pass",
    finding: highVolumeTools.length > 0
      ? `High-volume tools detected: ${highVolumeTools.join(", ")}. Review autonomy settings and approval queue configuration.`
      : `${summary.totalExecutions} total executions across ${uniqueTools.length} tools. Tool usage within normal bounds.`,
  });

  // LLM10: Model Theft
  // Tool audit ensures all agent actions are logged and traceable.
  controls.push({
    id: "LLM10",
    name: "Model Theft",
    status: "pass",
    finding: "Tool execution audit trail is active. All invocations are logged with timestamps and redacted inputs for traceability.",
  });

  return controls;
}

/**
 * Generate an OWASP GenAI Top 10 compliance report from tool audit data.
 */
export function generateComplianceReport(report: ToolAuditReport): string {
  const controls = assessCompliance(report);
  const lines: string[] = [];

  lines.push("CLAWHQ COMPLIANCE REPORT");
  lines.push("OWASP Top 10 for LLM Applications");
  lines.push("=".repeat(50));
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Period: ${report.since ?? "all time"} → ${report.until}`);
  lines.push(`Data source: Tool execution audit trail (${report.summary.totalExecutions} entries)`);
  lines.push("");

  const passCount = controls.filter((c) => c.status === "pass").length;
  const warnCount = controls.filter((c) => c.status === "warn").length;
  const infoCount = controls.filter((c) => c.status === "info").length;

  lines.push("SUMMARY");
  lines.push("-".repeat(50));
  lines.push(`  PASS: ${passCount}  |  WARN: ${warnCount}  |  INFO: ${infoCount}`);
  lines.push("");

  lines.push("CONTROLS");
  lines.push("-".repeat(50));

  for (const control of controls) {
    const icon = control.status === "pass" ? "PASS"
      : control.status === "warn" ? "WARN"
      : "INFO";
    lines.push(`  [${icon}] ${control.id}: ${control.name}`);
    lines.push(`         ${control.finding}`);
    lines.push("");
  }

  // Integrity digest
  const content = lines.join("\n");
  const digest = createHash("sha256").update(content).digest("hex");

  lines.push("INTEGRITY");
  lines.push("-".repeat(50));
  lines.push(`SHA-256: ${digest}`);

  return lines.join("\n");
}

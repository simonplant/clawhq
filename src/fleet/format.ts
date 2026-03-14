/**
 * Fleet dashboard formatter.
 *
 * Renders fleet reports as terminal dashboards with aggregated views
 * and per-agent drill-down sections.
 */

import type { FleetDoctorReport, FleetReport } from "./types.js";

// --- Helpers ---

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value < 10 && i > 0 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

function pad(str: string, width: number): string {
  return str.padEnd(width);
}

function sectionHeader(title: string): string {
  return `\n${"=".repeat(50)}\n  ${title}\n${"=".repeat(50)}`;
}

// --- Health section ---

function formatHealthSection(report: FleetReport): string {
  const { health } = report;
  const lines: string[] = [sectionHeader("FLEET HEALTH")];

  lines.push(`  Total agents: ${health.total}`);
  lines.push(`  Running:      ${health.running}`);
  if (health.stopped > 0) lines.push(`  Stopped:      ${health.stopped}`);
  if (health.degraded > 0) lines.push(`  Degraded:     ${health.degraded}`);
  if (health.unknown > 0) lines.push(`  Unknown:      ${health.unknown}`);

  // Per-agent status table
  lines.push("");
  const idWidth = Math.max(8, ...report.agents.map((a) => a.agent.id.length));
  lines.push(`  ${pad("AGENT", idWidth)}  STATE      GATEWAY`);
  lines.push(`  ${"-".repeat(idWidth + 22)}`);

  for (const entry of report.agents) {
    const state = entry.status.state.toUpperCase();
    const gw = entry.status.gatewayStatus.toUpperCase();
    const errSuffix = entry.error ? ` (${entry.error})` : "";
    lines.push(`  ${pad(entry.agent.id, idWidth)}  ${pad(state, 9)}  ${gw}${errSuffix}`);
  }

  return lines.join("\n");
}

// --- Cost section ---

function formatCostSection(report: FleetReport): string {
  const { cost } = report;
  const lines: string[] = [sectionHeader("FLEET COST (EGRESS)")];

  lines.push(`  Total egress:     ${formatBytes(cost.totalEgressBytes)} (${cost.totalEgressCalls} calls)`);
  lines.push(`  Zero-egress agents: ${cost.zeroEgressCount}/${report.agents.length}`);

  if (cost.totalEgressBytes === 0) {
    lines.push("");
    lines.push("  ** ZERO EGRESS ** No data sent to cloud across fleet");
  }

  // Per-agent breakdown
  lines.push("");
  const idWidth = Math.max(8, ...cost.perAgent.map((a) => a.agentId.length));
  lines.push(`  ${pad("AGENT", idWidth)}  ${pad("EGRESS", 12)}  CALLS  ZERO`);
  lines.push(`  ${"-".repeat(idWidth + 30)}`);

  for (const entry of cost.perAgent) {
    const zero = entry.zeroEgress ? "yes" : "no";
    lines.push(
      `  ${pad(entry.agentId, idWidth)}  ${pad(formatBytes(entry.egressBytes), 12)}  ${String(entry.egressCalls).padEnd(5)}  ${zero}`,
    );
  }

  return lines.join("\n");
}

// --- Security section ---

function formatSecuritySection(report: FleetReport): string {
  const { security } = report;
  const lines: string[] = [sectionHeader("FLEET SECURITY")];

  lines.push(`  Total integrations: ${security.totalIntegrations}`);
  lines.push(`  Valid:              ${security.validCount}`);
  if (security.failingCount > 0) {
    lines.push(`  Failing:            ${security.failingCount}`);
  }

  // Per-agent breakdown
  lines.push("");
  const idWidth = Math.max(8, ...security.perAgent.map((a) => a.agentId.length));
  lines.push(`  ${pad("AGENT", idWidth)}  VALID  FAILING  TOTAL`);
  lines.push(`  ${"-".repeat(idWidth + 26)}`);

  for (const entry of security.perAgent) {
    lines.push(
      `  ${pad(entry.agentId, idWidth)}  ${String(entry.valid).padEnd(5)}  ${String(entry.failing).padEnd(7)}  ${entry.total}`,
    );
  }

  return lines.join("\n");
}

// --- Per-agent drill-down ---

function formatAgentDrillDown(report: FleetReport): string {
  const lines: string[] = [sectionHeader("PER-AGENT DETAILS")];

  for (const entry of report.agents) {
    lines.push("");
    lines.push(`  --- ${entry.agent.id}${entry.agent.isDefault ? " (default)" : ""} ---`);
    lines.push(`  State:     ${entry.status.state.toUpperCase()}`);
    lines.push(`  Gateway:   ${entry.status.gatewayStatus.toUpperCase()}`);

    if (entry.status.uptime) {
      lines.push(`  Uptime:    ${entry.status.uptime}`);
    }

    // Memory summary
    const memBytes = entry.workspace.totalMemoryBytes;
    lines.push(`  Memory:    ${formatBytes(memBytes)} (${entry.workspace.memoryTiers.length} tiers)`);
    lines.push(`  Identity:  ~${entry.workspace.totalIdentityTokens} tokens`);

    // Integration summary
    const intCounts = entry.integrations.counts;
    const intTotal = entry.integrations.integrations.length - intCounts.missing;
    lines.push(`  Integrations: ${intCounts.valid} valid, ${intCounts.failing + intCounts.expired} failing (${intTotal} configured)`);

    // Egress summary
    lines.push(`  Egress:    ${formatBytes(entry.egress.month.bytes)} this month${entry.egress.zeroEgress ? " (zero egress)" : ""}`);

    if (entry.error) {
      lines.push(`  Error:     ${entry.error}`);
    }
  }

  return lines.join("\n");
}

// --- Public API ---

/**
 * Format a FleetReport as a terminal dashboard.
 */
export function formatFleetDashboard(report: FleetReport): string {
  const sections = [
    formatHealthSection(report),
    formatCostSection(report),
    formatSecuritySection(report),
    formatAgentDrillDown(report),
  ];

  return sections.join("\n") + "\n";
}

/**
 * Format a FleetReport as JSON.
 */
export function formatFleetJson(report: FleetReport): string {
  return JSON.stringify(report, null, 2);
}

// --- Fleet doctor formatting ---

const STATUS_ICONS: Record<string, string> = {
  pass: "PASS",
  warn: "WARN",
  fail: "FAIL",
};

/**
 * Format a FleetDoctorReport as a terminal table.
 */
export function formatFleetDoctorTable(report: FleetDoctorReport): string {
  const lines: string[] = [];

  for (const entry of report.entries) {
    lines.push(sectionHeader(`DOCTOR: ${entry.agentId}`));

    if (entry.error) {
      lines.push(`  Error: ${entry.error}`);
      lines.push("");
      continue;
    }

    if (entry.report.checks.length === 0) {
      lines.push("  No checks ran");
      lines.push("");
      continue;
    }

    const nameWidth = Math.max(5, ...entry.report.checks.map((c) => c.name.length));

    lines.push(`  ${pad("CHECK", nameWidth)}  STATUS  MESSAGE`);
    lines.push(`  ${"-".repeat(nameWidth + 20)}`);

    for (const check of entry.report.checks) {
      const icon = STATUS_ICONS[check.status] ?? check.status.toUpperCase();
      lines.push(`  ${pad(check.name, nameWidth)}  ${pad(icon, 6)}  ${check.message}`);
    }

    lines.push("");
    lines.push(
      `  ${entry.report.counts.pass} passed, ${entry.report.counts.warn} warnings, ${entry.report.counts.fail} failed`,
    );
  }

  // Fleet summary
  lines.push(sectionHeader("FLEET DOCTOR SUMMARY"));
  lines.push(`  All passed: ${report.allPassed ? "YES" : "NO"}`);
  lines.push(`  Total: ${report.totals.pass} passed, ${report.totals.warn} warnings, ${report.totals.fail} failed`);

  return lines.join("\n") + "\n";
}

/**
 * Format a FleetDoctorReport as JSON.
 */
export function formatFleetDoctorJson(report: FleetDoctorReport): string {
  return JSON.stringify(report, null, 2);
}

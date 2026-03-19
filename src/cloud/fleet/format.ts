/**
 * Terminal formatters for fleet management output.
 *
 * Two modes: table (human-friendly) and JSON (automation).
 */

import type { DiscoveredAgent, FleetDoctorReport, FleetHealthStatus, FleetRegistry } from "./types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Right-pad a string to a given width. */
function pad(str: string, width: number): string {
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}

function agentStatusSymbol(agent: DiscoveredAgent): string {
  if (!agent.exists) return "✘ missing";
  if (!agent.configured) return "- unconfigured";
  if (agent.health?.containerRunning) return "✔ running";
  return "✘ stopped";
}

// ── Fleet List ──────────────────────────────────────────────────────────────

export function formatFleetList(registry: FleetRegistry): string {
  if (registry.agents.length === 0) {
    return "No agents registered. Add one with: clawhq cloud fleet add <name> <path>";
  }

  const col1 = Math.max(4, ...registry.agents.map((a) => a.name.length)) + 2;
  const col2 = Math.max(4, ...registry.agents.map((a) => a.deployDir.length)) + 2;

  const header = pad("Name", col1) + pad("Path", col2) + "Added";
  const separator = pad("─".repeat(col1 - 2), col1) + pad("─".repeat(col2 - 2), col2) + "─".repeat(20);

  const rows = registry.agents.map((a) =>
    pad(a.name, col1) + pad(a.deployDir, col2) + a.addedAt,
  );

  return [header, separator, ...rows].join("\n");
}

export function formatFleetListJson(registry: FleetRegistry): string {
  return JSON.stringify(registry, null, 2);
}

// ── Fleet Health ────────────────────────────────────────────────────────────

export function formatFleetHealth(status: FleetHealthStatus): string {
  if (status.agents.length === 0) {
    return "No agents registered. Add one with: clawhq cloud fleet add <name> <path>";
  }

  const col1 = Math.max(4, ...status.agents.map((a) => a.name.length)) + 2;
  const col2 = 16; // "✔ running    "

  const lines: string[] = [];
  lines.push("");
  lines.push("Fleet Health");
  lines.push("============");
  lines.push("");

  const header = pad("Agent", col1) + pad("Status", col2) + "Details";
  const separator = pad("─".repeat(col1 - 2), col1) + pad("─".repeat(col2 - 2), col2) + "─".repeat(40);

  lines.push(header);
  lines.push(separator);

  for (const agent of status.agents) {
    const symbol = agentStatusSymbol(agent);
    let details = "";
    if (agent.health) {
      const parts: string[] = [];
      parts.push(`integrations: ${agent.health.integrationCount}`);
      parts.push(`trust: ${agent.health.trustMode}`);
      if (agent.health.diskUsagePercent > 0) {
        parts.push(`disk: ${agent.health.diskUsagePercent}%`);
      }
      details = parts.join(", ");
    } else if (!agent.exists) {
      details = agent.deployDir;
    }
    lines.push(pad(agent.name, col1) + pad(symbol, col2) + details);
  }

  lines.push("");

  // Summary
  const { healthyCount, unhealthyCount, unavailableCount } = status;
  if (status.allHealthy) {
    lines.push(`✔ All ${healthyCount} agent(s) healthy`);
  } else {
    const parts: string[] = [];
    if (healthyCount > 0) parts.push(`${healthyCount} healthy`);
    if (unhealthyCount > 0) parts.push(`${unhealthyCount} unhealthy`);
    if (unavailableCount > 0) parts.push(`${unavailableCount} unavailable`);
    lines.push(parts.join(", "));
  }

  lines.push("");
  return lines.join("\n");
}

export function formatFleetHealthJson(status: FleetHealthStatus): string {
  return JSON.stringify(
    {
      timestamp: status.timestamp,
      allHealthy: status.allHealthy,
      summary: {
        healthy: status.healthyCount,
        unhealthy: status.unhealthyCount,
        unavailable: status.unavailableCount,
        total: status.agents.length,
      },
      agents: status.agents.map((a) => ({
        name: a.name,
        deployDir: a.deployDir,
        exists: a.exists,
        configured: a.configured,
        health: a.health ?? null,
      })),
    },
    null,
    2,
  );
}

// ── Fleet Doctor ────────────────────────────────────────────────────────────

export function formatFleetDoctor(report: FleetDoctorReport): string {
  if (report.agents.length === 0) {
    return "No agents registered. Add one with: clawhq cloud fleet add <name> <path>";
  }

  const lines: string[] = [];
  lines.push("");
  lines.push("Fleet Doctor");
  lines.push("============");

  for (const agent of report.agents) {
    lines.push("");
    lines.push(`── ${agent.name} (${agent.deployDir}) ──`);

    if (agent.error) {
      lines.push(`  ✘ Error: ${agent.error}`);
      continue;
    }

    if (!agent.report) {
      lines.push("  ✘ No report available");
      continue;
    }

    const { report: dr } = agent;
    if (dr.healthy) {
      lines.push(`  ✔ All ${dr.checks.length} checks passed`);
    } else {
      for (const check of dr.checks) {
        if (!check.passed) {
          const severity = check.severity === "error" ? "✘" : "⚠";
          lines.push(`  ${severity} ${check.name}: ${check.message}`);
          if (check.fix) {
            lines.push(`    → ${check.fix}`);
          }
        }
      }
      const parts: string[] = [];
      parts.push(`${dr.passed.length} passed`);
      if (dr.errors.length > 0) parts.push(`${dr.errors.length} error(s)`);
      if (dr.warnings.length > 0) parts.push(`${dr.warnings.length} warning(s)`);
      lines.push(`  ${parts.join(", ")} out of ${dr.checks.length} checks`);
    }
  }

  // Fleet summary
  lines.push("");
  const { healthyCount, unhealthyCount, unreachableCount } = report;
  if (report.allHealthy) {
    lines.push(`✔ All ${healthyCount} agent(s) healthy`);
  } else {
    const parts: string[] = [];
    if (healthyCount > 0) parts.push(`${healthyCount} healthy`);
    if (unhealthyCount > 0) parts.push(`${unhealthyCount} with issues`);
    if (unreachableCount > 0) parts.push(`${unreachableCount} unreachable`);
    lines.push(parts.join(", "));
  }

  lines.push("");
  return lines.join("\n");
}

export function formatFleetDoctorJson(report: FleetDoctorReport): string {
  return JSON.stringify(
    {
      timestamp: report.timestamp,
      allHealthy: report.allHealthy,
      summary: {
        healthy: report.healthyCount,
        unhealthy: report.unhealthyCount,
        unreachable: report.unreachableCount,
        total: report.agents.length,
      },
      agents: report.agents.map((a) => ({
        name: a.name,
        deployDir: a.deployDir,
        error: a.error ?? null,
        report: a.report
          ? {
              healthy: a.report.healthy,
              total: a.report.checks.length,
              passed: a.report.passed.length,
              errors: a.report.errors.length,
              warnings: a.report.warnings.length,
              checks: a.report.checks.map((c) => ({
                name: c.name,
                passed: c.passed,
                severity: c.severity,
                message: c.message,
              })),
            }
          : null,
      })),
    },
    null,
    2,
  );
}

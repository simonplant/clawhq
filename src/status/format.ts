/**
 * Status dashboard formatter.
 *
 * Renders a StatusReport as a clean terminal dashboard with sections,
 * or as JSON for machine-readable output.
 */

import type { StatusReport } from "./types.js";

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

// --- Agent state section ---

function formatAgentSection(report: StatusReport): string {
  const { agent } = report;
  const lines: string[] = [sectionHeader("AGENT STATE")];

  const stateLabel = agent.state.toUpperCase();
  lines.push(`  State:    ${stateLabel}`);

  if (agent.containerId) {
    lines.push(`  Container: ${agent.containerId.slice(0, 12)}`);
  }
  if (agent.containerName) {
    lines.push(`  Name:      ${agent.containerName}`);
  }
  if (agent.image) {
    lines.push(`  Image:     ${agent.image}`);
  }
  if (agent.uptime) {
    lines.push(`  Uptime:    ${agent.uptime}`);
  }

  const gwLabel = agent.gatewayStatus.toUpperCase();
  const latency = agent.gatewayLatencyMs !== undefined
    ? ` (${agent.gatewayLatencyMs}ms)`
    : "";
  lines.push(`  Gateway:   ${gwLabel}${latency}`);

  return lines.join("\n");
}

// --- Integration health section ---

function formatIntegrationSection(report: StatusReport): string {
  const { integrations } = report;
  const lines: string[] = [sectionHeader("INTEGRATION HEALTH")];

  if (integrations.integrations.length === 0) {
    lines.push("  No integrations configured");
    return lines.join("\n");
  }

  const STATUS_LABELS: Record<string, string> = {
    valid: "VALID",
    expired: "EXPRD",
    failing: "FAIL",
    error: "ERROR",
    missing: "SKIP",
  };

  const nameWidth = Math.max(10, ...integrations.integrations.map((i) => i.provider.length));

  lines.push(`  ${pad("PROVIDER", nameWidth)}  STATUS  MESSAGE`);
  lines.push(`  ${"-".repeat(nameWidth + 20)}`);

  for (const integration of integrations.integrations) {
    const label = STATUS_LABELS[integration.status] ?? integration.status.toUpperCase();
    lines.push(`  ${pad(integration.provider, nameWidth)}  ${pad(label, 6)}  ${integration.message}`);
  }

  const { counts } = integrations;
  const configured = integrations.integrations.length - counts.missing;
  lines.push("");
  lines.push(`  ${counts.valid} valid, ${counts.failing + counts.expired} failing, ${counts.missing} skipped (${configured} configured)`);

  return lines.join("\n");
}

// --- Workspace metrics section ---

function formatWorkspaceSection(report: StatusReport): string {
  const { workspace } = report;
  const lines: string[] = [sectionHeader("WORKSPACE METRICS")];

  // Memory tiers
  lines.push("  Memory:");
  if (workspace.memoryTiers.length === 0) {
    lines.push("    No memory tiers found");
  } else {
    for (const tier of workspace.memoryTiers) {
      const size = formatBytes(tier.sizeBytes);
      lines.push(`    ${pad(tier.tier, 6)}  ${pad(size, 10)}  ${tier.fileCount} file${tier.fileCount !== 1 ? "s" : ""}`);
    }
    lines.push(`    Total: ${formatBytes(workspace.totalMemoryBytes)}`);
  }

  // Identity files
  lines.push("");
  lines.push("  Identity files:");
  if (workspace.identityFiles.length === 0) {
    lines.push("    No identity files found");
  } else {
    for (const file of workspace.identityFiles) {
      const size = formatBytes(file.sizeBytes);
      lines.push(`    ${pad(file.name, 16)}  ${pad(size, 10)}  ~${file.estimatedTokens} tokens`);
    }
    lines.push(`    Total: ~${workspace.totalIdentityTokens} tokens`);
  }

  return lines.join("\n");
}

// --- Data egress section ---

function formatEgressSection(report: StatusReport): string {
  const { egress } = report;
  const lines: string[] = [sectionHeader("DATA EGRESS")];

  if (egress.zeroEgress) {
    lines.push("  ** ZERO EGRESS ** No data sent to cloud this month");
    lines.push("");
  }

  lines.push(`  ${pad("PERIOD", 12)}  ${pad("BYTES", 10)}  CALLS`);
  lines.push(`  ${"-".repeat(35)}`);

  const periods = [egress.today, egress.week, egress.month];
  for (const period of periods) {
    lines.push(`  ${pad(period.label, 12)}  ${pad(formatBytes(period.bytes), 10)}  ${period.calls}`);
  }

  return lines.join("\n");
}

// --- Channel health section ---

function formatChannelSection(report: StatusReport): string {
  const lines: string[] = [sectionHeader("CHANNELS")];

  if (report.channels.length === 0) {
    lines.push("  No channels configured");
    return lines.join("\n");
  }

  const STATUS_LABELS: Record<string, string> = {
    connected: "OK",
    disconnected: "OFF",
    error: "ERR",
    unconfigured: "NONE",
  };

  const nameWidth = Math.max(10, ...report.channels.map((c) => c.channel.length));

  lines.push(`  ${pad("CHANNEL", nameWidth)}  STATUS  MESSAGE`);
  lines.push(`  ${"-".repeat(nameWidth + 20)}`);

  for (const ch of report.channels) {
    const label = (STATUS_LABELS[ch.status] ?? ch.status.toUpperCase()).padEnd(6);
    const display = ch.displayName ? `${ch.message} (${ch.displayName})` : ch.message;
    lines.push(`  ${pad(ch.channel, nameWidth)}  ${label}  ${display}`);
  }

  return lines.join("\n");
}

// --- Public API ---

/**
 * Format a StatusReport as a terminal dashboard.
 */
export function formatDashboard(report: StatusReport): string {
  const sections = [
    formatAgentSection(report),
    formatIntegrationSection(report),
    formatChannelSection(report),
    formatWorkspaceSection(report),
    formatEgressSection(report),
  ];

  return sections.join("\n") + "\n";
}

/**
 * Format a StatusReport as JSON.
 */
export function formatJson(report: StatusReport): string {
  return JSON.stringify(report, null, 2);
}

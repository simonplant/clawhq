/**
 * Formatters for monitor output — table and JSON formats.
 */

import type { DigestContent, MonitorEvent, MonitorState } from "./types.js";

// ── Monitor State ───────────────────────────────────────────────────────────

export function formatMonitorStateTable(state: MonitorState): string {
  const lines: string[] = [
    "",
    "  Monitor Daemon Status",
    "  " + "─".repeat(40),
    `  Running:          ${state.running ? "yes" : "no"}`,
    `  Started:          ${state.startedAt ?? "—"}`,
    `  Last check:       ${state.lastCheck ?? "—"}`,
    `  Alerts today:     ${state.alertsToday}`,
    `  Recoveries today: ${state.recoveriesToday}`,
    `  Digest sent:      ${state.digestSentToday ? "yes" : "no"}`,
    "",
  ];
  return lines.join("\n");
}

export function formatMonitorStateJson(state: MonitorState): string {
  return JSON.stringify(state, null, 2);
}

// ── Monitor Events ──────────────────────────────────────────────────────────

export function formatMonitorEvent(event: MonitorEvent): string {
  const time = new Date(event.timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `[${time}] ${event.type}: ${event.message}`;
}

// ── Digest ──────────────────────────────────────────────────────────────────

export function formatDigestTable(digest: DigestContent): string {
  const status = digest.healthy ? "HEALTHY" : "ISSUES DETECTED";
  const lines: string[] = [
    "",
    `  Daily Digest — ${status}`,
    "  " + "─".repeat(50),
    `  Period:     ${fmtDate(digest.period.from)} → ${fmtDate(digest.period.to)}`,
    `  Uptime:     ${digest.summary.uptime}`,
    `  Alerts:     ${digest.summary.alertsFired}`,
    `  Recoveries: ${digest.summary.recoveriesSucceeded}/${digest.summary.recoveriesAttempted}`,
    "",
  ];

  if (digest.resourceSnapshot) {
    const r = digest.resourceSnapshot;
    lines.push("  Resources:");
    lines.push(`    CPU:    ${r.cpuPercent.toFixed(1)}%`);
    if (r.memoryLimitMb > 0) {
      lines.push(`    Memory: ${r.memoryMb.toFixed(0)}MB / ${r.memoryLimitMb.toFixed(0)}MB`);
    }
    lines.push(`    Disk:   ${r.diskUsedPercent}% used (${r.diskFreeMb}MB free)`);
    lines.push("");
  }

  if (digest.alerts.length > 0) {
    lines.push("  Recent Alerts:");
    for (const a of digest.alerts.slice(0, 10)) {
      const sev = a.severity === "critical" ? "CRIT" : a.severity === "warning" ? "WARN" : "INFO";
      lines.push(`    [${sev}] ${a.message}`);
    }
    if (digest.alerts.length > 10) {
      lines.push(`    ... and ${digest.alerts.length - 10} more`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatDigestJson(digest: DigestContent): string {
  return JSON.stringify(digest, null, 2);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

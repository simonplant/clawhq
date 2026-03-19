/**
 * Output formatters for the status dashboard.
 *
 * Two modes:
 *   - Table: clean terminal dashboard with sections and color
 *   - JSON: structured output for scripting
 */

import type { StatusSnapshot } from "./types.js";

// ── Table Formatter ─────────────────────────────────────────────────────────

/**
 * Format a StatusSnapshot as a terminal dashboard.
 *
 * Example output:
 * ```
 * ── Agent Status ──────────────────────────────────
 *
 *   Agent       running   Up 2 hours
 *   Gateway     ✔ reachable (12ms)
 *   Config      ✔ valid
 *   Disk        42% used (12,400 MB free)
 *
 *   Overall: HEALTHY
 * ```
 */
export function formatStatusTable(snapshot: StatusSnapshot): string {
  const lines: string[] = [];

  lines.push("── Agent Status ──────────────────────────────────");
  lines.push("");

  // Container
  if (snapshot.container) {
    const stateIcon = snapshot.container.running ? "✔" : "✘";
    const stateLabel = snapshot.container.running ? "running" : snapshot.container.state;
    lines.push(`  Agent       ${stateIcon} ${stateLabel}   ${snapshot.container.startedAt}`);
    lines.push(`              ${snapshot.container.image}`);
    if (snapshot.container.health !== "none") {
      lines.push(`              health: ${snapshot.container.health}`);
    }
  } else {
    lines.push("  Agent       ✘ not running");
  }

  // Gateway
  if (snapshot.gateway.reachable) {
    const latency = snapshot.gateway.latencyMs != null ? ` (${snapshot.gateway.latencyMs}ms)` : "";
    lines.push(`  Gateway     ✔ reachable${latency}`);
  } else {
    lines.push("  Gateway     ✘ unreachable");
  }

  // Config
  if (snapshot.configValid) {
    lines.push("  Config      ✔ valid");
  } else {
    lines.push("  Config      ✘ invalid");
    for (const err of snapshot.configErrors) {
      lines.push(`              → ${err}`);
    }
  }

  // Disk
  if (snapshot.disk) {
    const freeLabel = snapshot.disk.freeMb >= 1024
      ? `${(snapshot.disk.freeMb / 1024).toFixed(1)} GB`
      : `${snapshot.disk.freeMb} MB`;
    lines.push(`  Disk        ${snapshot.disk.usedPercent}% used (${freeLabel} free)`);
  }

  lines.push("");

  // Overall
  if (snapshot.healthy) {
    lines.push("  Overall: HEALTHY");
  } else {
    lines.push("  Overall: UNHEALTHY");
    if (!snapshot.container?.running) {
      lines.push("    → Run: clawhq up");
    }
    if (!snapshot.gateway.reachable) {
      lines.push("    → Gateway not responding. Run: clawhq doctor");
    }
    if (!snapshot.configValid) {
      lines.push("    → Fix config: clawhq doctor --fix");
    }
  }

  return lines.join("\n");
}

// ── JSON Formatter ──────────────────────────────────────────────────────────

/**
 * Format a StatusSnapshot as JSON for scripting.
 */
export function formatStatusJson(snapshot: StatusSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

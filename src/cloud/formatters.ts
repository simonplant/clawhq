/**
 * Terminal formatters for cloud module output.
 */

import type { TrustMode } from "../config/types.js";
import type {
  CommandQueueState,
  DisconnectResult,
  HeartbeatState,
  SwitchModeResult,
  TrustModeState,
} from "./types.js";

// ── Trust mode switch result ─────────────────────────────────────────────────

export function formatSwitchResult(result: SwitchModeResult): string {
  if (!result.success) {
    return `Error: ${result.error}`;
  }
  if (result.previousMode === result.currentMode) {
    return `Already in ${result.currentMode} mode.`;
  }
  return `Trust mode switched: ${result.previousMode} -> ${result.currentMode}`;
}

// ── Disconnect result ────────────────────────────────────────────────────────

export function formatDisconnectResult(result: DisconnectResult): string {
  if (!result.success) {
    return `Error: ${result.error}`;
  }
  if (!result.wasConnected) {
    return "Not connected to cloud.";
  }
  return "Disconnected from cloud. Agent continues running.";
}

// ── Cloud status ─────────────────────────────────────────────────────────────

export interface CloudStatusSnapshot {
  readonly trustMode: TrustModeState;
  readonly heartbeat: HeartbeatState;
  readonly queue: CommandQueueState;
}

export function formatCloudStatus(snapshot: CloudStatusSnapshot): string {
  const lines: string[] = [];
  const { trustMode, heartbeat, queue } = snapshot;

  lines.push("");
  lines.push("Cloud Status");
  lines.push("============");
  lines.push("");
  lines.push(`  Trust mode:   ${trustMode.mode}`);
  lines.push(`  Connected:    ${trustMode.connected ? "yes" : "no"}`);
  lines.push(`  Changed at:   ${trustMode.changedAt}`);

  if (trustMode.connectedAt) {
    lines.push(`  Connected at: ${trustMode.connectedAt}`);
  }
  if (trustMode.disconnectedAt) {
    lines.push(`  Disconnected: ${trustMode.disconnectedAt}`);
  }

  lines.push("");
  lines.push("  Heartbeat");
  lines.push("  ---------");
  if (heartbeat.lastSentAt) {
    lines.push(`  Last sent:    ${heartbeat.lastSentAt}`);
  } else {
    lines.push("  Last sent:    never");
  }
  lines.push(`  Failures:     ${heartbeat.consecutiveFailures}`);
  if (heartbeat.lastError) {
    lines.push(`  Last error:   ${heartbeat.lastError}`);
  }

  lines.push("");
  lines.push("  Command Queue");
  lines.push("  -------------");
  lines.push(`  Pending:      ${queue.pending.length}`);
  lines.push(`  History:      ${queue.history.length}`);
  lines.push("");

  return lines.join("\n");
}

export function formatCloudStatusJson(snapshot: CloudStatusSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

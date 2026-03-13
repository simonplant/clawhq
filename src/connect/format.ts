/**
 * Channel connection formatters and health collector.
 *
 * Provides terminal output for connect results and channel health
 * for the status dashboard.
 */

import { telegramFlow } from "./telegram.js";
import type { ChannelHealth, ChannelStatus, ChannelTestResult, ConnectOptions } from "./types.js";
import { whatsappFlow } from "./whatsapp.js";

const ALL_FLOWS = [telegramFlow, whatsappFlow];

/**
 * Collect health for all supported channels.
 * Used by the status dashboard to show channel connection status.
 */
export async function collectChannelHealth(options: ConnectOptions): Promise<ChannelHealth[]> {
  const results: ChannelHealth[] = [];

  for (const flow of ALL_FLOWS) {
    try {
      const health = await flow.health(options);
      // Only include channels that are at least partially configured
      if (health.status !== "unconfigured") {
        results.push(health);
      }
    } catch {
      results.push({
        channel: flow.channel,
        status: "error",
        message: "Health check failed",
      });
    }
  }

  return results;
}

/**
 * Format channel health as a dashboard section.
 */
export function formatChannelSection(channels: ChannelHealth[]): string {
  const STATUS_LABELS: Record<ChannelStatus, string> = {
    connected: "OK",
    disconnected: "OFF",
    error: "ERR",
    unconfigured: "NONE",
  };

  if (channels.length === 0) {
    return "  No channels configured";
  }

  const nameWidth = Math.max(10, ...channels.map((c) => c.channel.length));
  const lines: string[] = [];

  lines.push(`  ${"CHANNEL".padEnd(nameWidth)}  STATUS  MESSAGE`);
  lines.push(`  ${"-".repeat(nameWidth + 20)}`);

  for (const ch of channels) {
    const label = STATUS_LABELS[ch.status].padEnd(6);
    const display = ch.displayName ? `${ch.message} (${ch.displayName})` : ch.message;
    lines.push(`  ${ch.channel.padEnd(nameWidth)}  ${label}  ${display}`);
  }

  return lines.join("\n");
}

/**
 * Format a channel test result for CLI output.
 */
export function formatTestResult(result: ChannelTestResult): string {
  const lines: string[] = [];

  lines.push(`Channel: ${result.channel}`);
  lines.push("");

  for (let i = 0; i < result.steps.length; i++) {
    const step = result.steps[i];
    const icon = step.passed ? "OK" : "FAIL";
    lines.push(`  [${i + 1}/${result.steps.length}] ${icon}  ${step.name}: ${step.message}`);
  }

  lines.push("");
  const allPassed = result.success;
  lines.push(allPassed ? "Connection test: PASS" : "Connection test: FAIL");

  return lines.join("\n");
}

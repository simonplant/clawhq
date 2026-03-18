/**
 * Slack notification sender.
 *
 * Sends notification events to a Slack incoming webhook.
 */

import type { DispatchResult, NotificationEvent, SlackChannel } from "./types.js";

const TIMEOUT_MS = 10_000;

/**
 * Send a notification event to a Slack channel via incoming webhook.
 */
export async function sendSlack(
  channel: SlackChannel,
  event: NotificationEvent,
): Promise<DispatchResult> {
  const payload = {
    text: `*${event.title}*\n${event.message}\n_${event.type} · ${event.timestamp}_`,
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(channel.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (response.ok) {
      return { channelId: channel.id, channelName: channel.name, channelType: "slack", sent: true };
    }

    return {
      channelId: channel.id,
      channelName: channel.name,
      channelType: "slack",
      sent: false,
      error: `Slack returned ${response.status}`,
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return { channelId: channel.id, channelName: channel.name, channelType: "slack", sent: false, error: "Request timed out" };
    }
    return {
      channelId: channel.id,
      channelName: channel.name,
      channelType: "slack",
      sent: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

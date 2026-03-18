/**
 * Notification event dispatcher.
 *
 * Iterates configured channels and sends events to those
 * whose subscriptions match the event type.
 */

import { sendSlack } from "./slack.js";
import { loadChannels } from "./store.js";
import { sendTelegram } from "./telegram.js";
import type { DispatchResult, NotificationChannel, NotificationEvent } from "./types.js";
import { sendWebhook } from "./webhook.js";

/**
 * Send a notification event to a single channel.
 */
async function sendToChannel(
  channel: NotificationChannel,
  event: NotificationEvent,
): Promise<DispatchResult> {
  switch (channel.type) {
    case "webhook":
      return sendWebhook(channel, event);
    case "telegram":
      return sendTelegram(channel, event);
    case "slack":
      return sendSlack(channel, event);
    case "email":
      // Email transport is a future extension
      return {
        channelId: channel.id,
        channelName: channel.name,
        channelType: "email",
        sent: false,
        error: "Email transport not yet implemented",
      };
  }
}

/**
 * Dispatch a notification event to all matching channels.
 *
 * Channels match if they are enabled and subscribe to the event type.
 * Dispatch is best-effort — failures on one channel don't block others.
 */
export async function dispatch(
  event: NotificationEvent,
  clawhqHome: string,
  storePath?: string,
): Promise<DispatchResult[]> {
  const channels = await loadChannels(clawhqHome, storePath);

  const matching = channels.filter(
    (c) => c.enabled && c.events.includes(event.type),
  );

  if (matching.length === 0) return [];

  const results = await Promise.allSettled(
    matching.map((c) => sendToChannel(c, event)),
  );

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      channelId: matching[i].id,
      channelName: matching[i].name,
      channelType: matching[i].type,
      sent: false,
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    };
  });
}

/**
 * Dispatch a test event to a specific channel by ID.
 */
export async function dispatchTest(
  channelId: string,
  clawhqHome: string,
  storePath?: string,
): Promise<DispatchResult> {
  const channels = await loadChannels(clawhqHome, storePath);
  const channel = channels.find((c) => c.id === channelId);

  if (!channel) {
    return {
      channelId,
      channelName: "unknown",
      channelType: "webhook",
      sent: false,
      error: `Channel ${channelId} not found`,
    };
  }

  const testEvent: NotificationEvent = {
    type: "alert.warning",
    title: "Test notification from ClawHQ",
    message: "If you received this, your notification channel is working correctly.",
    timestamp: new Date().toISOString(),
    meta: { test: true },
  };

  return sendToChannel(channel, testEvent);
}

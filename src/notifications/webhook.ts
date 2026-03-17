/**
 * Webhook notification sender.
 *
 * Sends JSON payloads to webhook URLs, signed with HMAC-SHA256.
 */

import { createHmac } from "node:crypto";

import type { DispatchResult, NotificationEvent, WebhookChannel } from "./types.js";

const TIMEOUT_MS = 10_000;

/**
 * Sign a payload with HMAC-SHA256.
 */
export function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Send a notification event to a webhook channel.
 */
export async function sendWebhook(
  channel: WebhookChannel,
  event: NotificationEvent,
): Promise<DispatchResult> {
  const body = JSON.stringify(event);
  const signature = signPayload(body, channel.secret);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(channel.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ClawHQ-Signature": `sha256=${signature}`,
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (response.ok) {
      return { channelId: channel.id, channelName: channel.name, channelType: "webhook", sent: true };
    }

    return {
      channelId: channel.id,
      channelName: channel.name,
      channelType: "webhook",
      sent: false,
      error: `HTTP ${response.status}`,
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return { channelId: channel.id, channelName: channel.name, channelType: "webhook", sent: false, error: "Request timed out" };
    }
    return {
      channelId: channel.id,
      channelName: channel.name,
      channelType: "webhook",
      sent: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

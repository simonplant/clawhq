/**
 * Telegram notification sender.
 *
 * Sends notification events to a Telegram chat via Bot API.
 */

import type { DispatchResult, NotificationEvent, TelegramChannel } from "./types.js";

const TELEGRAM_API = "https://api.telegram.org";
const TIMEOUT_MS = 10_000;

/**
 * Format a notification event as a Telegram message.
 */
function formatMessage(event: NotificationEvent): string {
  const lines: string[] = [
    `⚡ ${event.title}`,
    "",
    event.message,
    "",
    `Event: ${event.type}`,
    `Time: ${event.timestamp}`,
  ];
  return lines.join("\n");
}

/**
 * Send a notification event to a Telegram channel.
 */
export async function sendTelegram(
  channel: TelegramChannel,
  event: NotificationEvent,
): Promise<DispatchResult> {
  const text = formatMessage(event);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(`${TELEGRAM_API}/bot${channel.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: channel.chatId, text }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (response.ok) {
      return { channelId: channel.id, channelName: channel.name, channelType: "telegram", sent: true };
    }

    return {
      channelId: channel.id,
      channelName: channel.name,
      channelType: "telegram",
      sent: false,
      error: `Telegram API returned ${response.status}`,
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return { channelId: channel.id, channelName: channel.name, channelType: "telegram", sent: false, error: "Request timed out" };
    }
    return {
      channelId: channel.id,
      channelName: channel.name,
      channelType: "telegram",
      sent: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

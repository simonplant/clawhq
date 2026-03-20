/**
 * Multi-channel notification dispatcher.
 *
 * Sends alerts and digests to configured notification channels (Telegram,
 * email, webhook). Fire-and-forget — notification failures never block
 * the monitor loop.
 */

import { TELEGRAM_API_BASE } from "../../config/defaults.js";
import type {
  NotificationChannel,
  NotifyResult,
  TelegramNotificationChannel,
  WebhookNotificationChannel,
} from "./types.js";

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Send a text message to all enabled notification channels.
 *
 * Returns one result per channel. Never throws — errors are captured per channel.
 */
export async function sendNotification(
  channels: readonly NotificationChannel[],
  subject: string,
  body: string,
): Promise<readonly NotifyResult[]> {
  const enabled = channels.filter((c) => c.enabled);
  if (enabled.length === 0) return [];

  const results = await Promise.all(
    enabled.map((channel) => dispatchToChannel(channel, subject, body)),
  );

  return results;
}

// ── Channel Dispatchers ─────────────────────────────────────────────────────

async function dispatchToChannel(
  channel: NotificationChannel,
  subject: string,
  body: string,
): Promise<NotifyResult> {
  switch (channel.type) {
    case "telegram":
      return sendTelegram(channel, subject, body);
    case "webhook":
      return sendWebhook(channel, subject, body);
    case "email":
      // Email uses a simple HTTPS POST to avoid requiring nodemailer dependency.
      // In production, this would be replaced with SMTP transport.
      return { channel: "email", success: false, error: "Email channel not yet implemented" };
  }
}

// ── Telegram ────────────────────────────────────────────────────────────────

async function sendTelegram(
  config: TelegramNotificationChannel,
  subject: string,
  body: string,
): Promise<NotifyResult> {
  const text = `*${escapeMarkdown(subject)}*\n\n${escapeMarkdown(body)}`;

  try {
    const url = `${TELEGRAM_API_BASE}/bot${config.botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        parse_mode: "MarkdownV2",
      }),
    });

    if (!response.ok) {
      const responseBody = await response.text();
      return { channel: "telegram", success: false, error: `Telegram API ${response.status}: ${responseBody}` };
    }

    return { channel: "telegram", success: true };
  } catch (err) {
    return { channel: "telegram", success: false, error: String(err) };
  }
}

// ── Webhook ─────────────────────────────────────────────────────────────────

async function sendWebhook(
  config: WebhookNotificationChannel,
  subject: string,
  body: string,
): Promise<NotifyResult> {
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...config.headers,
      },
      body: JSON.stringify({
        subject,
        body,
        timestamp: new Date().toISOString(),
        source: "clawhq-monitor",
      }),
    });

    if (!response.ok) {
      return { channel: "webhook", success: false, error: `Webhook ${response.status}` };
    }

    return { channel: "webhook", success: true };
  } catch (err) {
    return { channel: "webhook", success: false, error: String(err) };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

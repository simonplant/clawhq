/**
 * Admin notification dispatcher types.
 *
 * Defines notification channels (webhook, telegram, slack, email),
 * event types, and dispatch configuration.
 */

import { randomUUID } from "node:crypto";

// --- Event types ---

export type NotificationEventType =
  | "alert.critical"
  | "alert.warning"
  | "approval.pending"
  | "health.degraded"
  | "health.recovered"
  | "update.available"
  | "backup.failed";

// --- Channel types ---

export type ChannelType = "webhook" | "telegram" | "slack" | "email";

/** Base fields shared by all notification channels. */
interface ChannelBase {
  /** Unique channel ID. */
  id: string;
  /** Human-readable label. */
  name: string;
  /** Channel type discriminator. */
  type: ChannelType;
  /** Which event types this channel subscribes to. */
  events: NotificationEventType[];
  /** Whether the channel is active. */
  enabled: boolean;
  /** When the channel was created. */
  createdAt: string;
}

/** Webhook notification channel. */
export interface WebhookChannel extends ChannelBase {
  type: "webhook";
  /** Webhook URL to POST to. */
  url: string;
  /** HMAC-SHA256 secret for payload signing. */
  secret: string;
}

/** Telegram notification channel. */
export interface TelegramChannel extends ChannelBase {
  type: "telegram";
  /** Telegram bot token. */
  token: string;
  /** Target chat ID. */
  chatId: string;
}

/** Slack notification channel. */
export interface SlackChannel extends ChannelBase {
  type: "slack";
  /** Slack incoming webhook URL. */
  webhookUrl: string;
}

/** Email notification channel. */
export interface EmailChannel extends ChannelBase {
  type: "email";
  /** Recipient email address. */
  to: string;
  /** SMTP connection string or path to sendmail. */
  transport: string;
}

/** Discriminated union of all channel types. */
export type NotificationChannel =
  | WebhookChannel
  | TelegramChannel
  | SlackChannel
  | EmailChannel;

// --- Event payload ---

/** Payload dispatched to notification channels. */
export interface NotificationEvent {
  /** Event type. */
  type: NotificationEventType;
  /** Human-readable title. */
  title: string;
  /** Detailed message. */
  message: string;
  /** ISO timestamp of the event. */
  timestamp: string;
  /** Optional structured metadata. */
  meta?: Record<string, unknown>;
}

// --- Dispatch result ---

/** Result of sending a notification to one channel. */
export interface DispatchResult {
  channelId: string;
  channelName: string;
  channelType: ChannelType;
  sent: boolean;
  error?: string;
}

// --- Helpers ---

/** Generate a new channel ID. */
export function newChannelId(): string {
  return randomUUID().slice(0, 8);
}

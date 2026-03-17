/**
 * Admin notification dispatcher module.
 *
 * Public API for managing notification channels and dispatching
 * events to webhook, Telegram, Slack, and email targets.
 */

export type {
  ChannelType,
  DispatchResult,
  EmailChannel,
  NotificationChannel,
  NotificationEvent,
  NotificationEventType,
  SlackChannel,
  TelegramChannel,
  WebhookChannel,
} from "./types.js";
export { newChannelId } from "./types.js";

export { dispatch, dispatchTest } from "./dispatcher.js";
export { sendSlack } from "./slack.js";
export {
  addChannel,
  getChannel,
  loadChannels,
  removeChannel,
  saveChannels,
} from "./store.js";
export { sendTelegram } from "./telegram.js";
export {
  notifyAlerts,
  notifyApprovalPending,
  notifyBackupFailed,
  notifyHealthChange,
  notifyUpdateAvailable,
} from "./hooks.js";
export { sendWebhook, signPayload } from "./webhook.js";

/**
 * Telegram notification for approval items.
 *
 * Sends a message to the user's Telegram chat with inline keyboard
 * buttons for approve/reject. Uses the Telegram Bot API directly —
 * this is an operational concern (not agent conversation), so ClawHQ
 * handles it outside of OpenClaw's messaging channels.
 *
 * Fire-and-forget: notification failures never block the enqueue pipeline.
 */

import { TELEGRAM_API_BASE } from "../../config/defaults.js";

import type { ApprovalItem } from "./types.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface TelegramConfig {
  /** Telegram Bot API token (from TELEGRAM_BOT_TOKEN in .env). */
  readonly botToken: string;
  /** Chat ID to send approval notifications to. */
  readonly chatId: string;
}

export interface NotifyResult {
  readonly success: boolean;
  readonly messageId?: number;
  readonly error?: string;
}

// ── Category Labels ──────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  send_email: "Send Email",
  send_message: "Send Message",
  account_change: "Account Change",
  public_post: "Public Post",
  delete: "Delete",
  purchase: "Purchase",
  other: "Action",
};

// ── Send Approval Notification ───────────────────────────────────────────────

/**
 * Send a Telegram message with approve/reject inline buttons.
 *
 * The callback_data encodes the item ID so the bot can resolve it
 * when the user taps a button.
 */
export async function sendApprovalNotification(
  config: TelegramConfig,
  item: ApprovalItem,
): Promise<NotifyResult> {
  const categoryLabel = CATEGORY_LABELS[item.category] ?? "Action";

  const text = [
    `*Approval Required*`,
    ``,
    `*${categoryLabel}:* ${escapeMarkdown(item.summary)}`,
    `*Source:* ${escapeMarkdown(item.source)}`,
    ...(item.detail ? [``, `${escapeMarkdown(truncate(item.detail, 500))}`] : []),
    ``,
    `ID: \`${item.id}\``,
  ].join("\n");

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: "Approve", callback_data: `apv:approve:${item.id}` },
        { text: "Reject", callback_data: `apv:reject:${item.id}` },
      ],
    ],
  };

  try {
    const url = `${TELEGRAM_API_BASE}/bot${config.botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        parse_mode: "MarkdownV2",
        reply_markup: inlineKeyboard,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return { success: false, error: `Telegram API ${response.status}: ${body}` };
    }

    const result = (await response.json()) as { ok?: boolean; result?: { message_id?: number } };
    if (result.ok && result.result?.message_id) {
      return { success: true, messageId: result.result.message_id };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ── Send Resolution Confirmation ─────────────────────────────────────────────

/**
 * Update the original notification message to show the resolution.
 * Removes the inline keyboard (action already taken).
 */
export async function sendResolutionConfirmation(
  config: TelegramConfig,
  item: ApprovalItem,
  messageId: number,
): Promise<void> {
  const categoryLabel = CATEGORY_LABELS[item.category] ?? "Action";
  const statusLabel = item.status === "approved" ? "Approved" : "Rejected";

  const text = [
    `*${categoryLabel}:* ${escapeMarkdown(item.summary)}`,
    ``,
    `*Status:* ${statusLabel}`,
    `ID: \`${item.id}\``,
  ].join("\n");

  try {
    const url = `${TELEGRAM_API_BASE}/bot${config.botToken}/editMessageText`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        message_id: messageId,
        text,
        parse_mode: "MarkdownV2",
      }),
    });
  } catch { /* best-effort notification */ }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Escape Markdown special characters for Telegram. */
function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

function truncate(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max - 1) + "...";
}

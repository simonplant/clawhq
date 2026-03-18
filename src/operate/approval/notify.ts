/**
 * Approval notification via Telegram.
 *
 * Sends approval requests to the user's Telegram channel
 * using the bot token from .env.
 */

import { readFile } from "node:fs/promises";

import { formatApprovalTelegram } from "./format.js";
import type { ApprovalEntry } from "./types.js";

const TELEGRAM_API = "https://api.telegram.org";
const TIMEOUT_MS = 10_000;

/**
 * Read the Telegram bot token from .env file.
 */
async function readTelegramToken(envPath: string): Promise<string | null> {
  try {
    const content = await readFile(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const eqIdx = trimmed.indexOf("=");
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (key === "TELEGRAM_BOT_TOKEN") return value;
    }
  } catch {
    // .env not found
  }
  return null;
}

/**
 * Read the Telegram chat ID from .env file.
 */
async function readTelegramChatId(envPath: string): Promise<string | null> {
  try {
    const content = await readFile(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const eqIdx = trimmed.indexOf("=");
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (key === "TELEGRAM_CHAT_ID") return value;
    }
  } catch {
    // .env not found
  }
  return null;
}

/** Result of sending a Telegram notification. */
export interface NotifyResult {
  sent: boolean;
  message: string;
}

/**
 * Send an approval notification to Telegram.
 */
export async function notifyTelegram(
  entry: ApprovalEntry,
  envPath: string,
): Promise<NotifyResult> {
  const token = await readTelegramToken(envPath);
  if (!token) {
    return { sent: false, message: "TELEGRAM_BOT_TOKEN not found in .env" };
  }

  const chatId = await readTelegramChatId(envPath);
  if (!chatId) {
    return { sent: false, message: "TELEGRAM_CHAT_ID not found in .env" };
  }

  const text = formatApprovalTelegram(entry);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (response.status === 200) {
      return { sent: true, message: "Notification sent to Telegram" };
    }

    return { sent: false, message: `Telegram API returned status ${response.status}` };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return { sent: false, message: "Request timed out" };
    }
    return { sent: false, message: `Network error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

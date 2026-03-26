/**
 * Action gate — enforces approval for high-stakes actions.
 *
 * This is the integration layer between agent action execution and the
 * approval queue. When the agent (or a workspace tool) wants to perform
 * a high-stakes action, it calls `submitForApproval()` instead of
 * executing directly. The action is queued, Telegram notification is
 * sent automatically (when configured), and the caller gets back an
 * approval item to poll for resolution.
 *
 * This module bridges the gap between the approval queue library and
 * real action paths — no high-stakes action executes without routing
 * through this gate.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { TelegramConfig } from "./notify.js";
import { sendApprovalNotification } from "./notify.js";
import { enqueue } from "./queue.js";
import type { ApprovalItem, EnqueueOptions } from "./types.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface GateOptions extends EnqueueOptions {
  /** Telegram config for auto-notification. If omitted, tries to load from .env. */
  readonly telegramConfig?: TelegramConfig;
}

export interface GateResult {
  readonly item: ApprovalItem;
  readonly notified: boolean;
  readonly notifyError?: string;
}

// ── Load Telegram Config ────────────────────────────────────────────────────

/**
 * Attempt to load Telegram config from the deployment .env file.
 * Returns undefined if either token or chat ID is missing.
 */
export function loadTelegramConfig(deployDir: string): TelegramConfig | undefined {
  const envPath = join(deployDir, "engine", ".env");
  if (!existsSync(envPath)) return undefined;

  try {
    const content = readFileSync(envPath, "utf-8");
    const botToken = parseEnvVar(content, "TELEGRAM_BOT_TOKEN");
    const chatId = parseEnvVar(content, "TELEGRAM_CHAT_ID");
    if (!botToken || !chatId) return undefined;
    return { botToken, chatId };
  } catch (err) {
    return undefined;
  }
}

/** Extract a value from .env file content. Supports unquoted and quoted values. */
function parseEnvVar(content: string, key: string): string | undefined {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eqIdx = trimmed.indexOf("=");
    const k = trimmed.slice(0, eqIdx).trim();
    if (k !== key) continue;
    let v = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    return v || undefined;
  }
  return undefined;
}

// ── Submit for Approval ─────────────────────────────────────────────────────

/**
 * Submit a high-stakes action for user approval.
 *
 * 1. Enqueues the action in the approval queue (workspace/memory/approval-queue.json)
 * 2. Sends a Telegram notification with approve/reject buttons (if configured)
 * 3. Returns the queued item and notification status
 *
 * This is the primary entry point for all high-stakes action gating.
 * Every action in a blueprint's `autonomy_model.requires_approval` list
 * must route through this function before execution.
 */
export async function submitForApproval(
  deployDir: string,
  options: GateOptions,
): Promise<GateResult> {
  // Step 1: Enqueue the action
  const item = await enqueue(deployDir, options);

  // Step 2: Auto-notify via Telegram (fire-and-forget on failure)
  const telegramConfig = options.telegramConfig ?? loadTelegramConfig(deployDir);
  if (telegramConfig) {
    const notifyResult = await sendApprovalNotification(telegramConfig, item);
    return {
      item,
      notified: notifyResult.success,
      notifyError: notifyResult.error,
    };
  }

  return { item, notified: false };
}

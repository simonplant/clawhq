/**
 * Telegram approval bot — polls for callback queries from inline keyboard
 * buttons and resolves approval items.
 *
 * Uses Telegram's getUpdates long-polling API. Runs as a background loop
 * managed by the `clawhq approval watch` command.
 *
 * Each callback_data has the format: `apv:approve:<itemId>` or `apv:reject:<itemId>`.
 */

import type { AuditTrailConfig } from "../../secure/audit/types.js";

import type { TelegramConfig } from "./notify.js";
import { sendResolutionConfirmation } from "./notify.js";
import { approve, reject, getItem } from "./queue.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface TelegramUpdate {
  readonly update_id: number;
  readonly callback_query?: {
    readonly id: string;
    readonly data?: string;
    readonly message?: {
      readonly message_id: number;
      readonly chat: { readonly id: number };
    };
  };
}

export interface ApprovalBotOptions {
  readonly deployDir: string;
  readonly telegramConfig: TelegramConfig;
  readonly auditConfig?: AuditTrailConfig;
  /** Called when an approval is resolved. */
  readonly onResolution?: (itemId: string, resolution: "approved" | "rejected") => void;
  /** Abort signal to stop the polling loop. */
  readonly signal?: AbortSignal;
}

// ── Polling Loop ─────────────────────────────────────────────────────────────

/**
 * Start the approval bot polling loop.
 *
 * Polls Telegram for callback queries and resolves matching approval items.
 * Returns when the abort signal fires.
 */
export async function startApprovalBot(opts: ApprovalBotOptions): Promise<void> {
  let offset = 0;
  const { deployDir, telegramConfig, auditConfig, onResolution, signal } = opts;

  while (!signal?.aborted) {
    try {
      const updates = await getUpdates(telegramConfig.botToken, offset, signal);

      for (const update of updates) {
        offset = update.update_id + 1;

        const callback = update.callback_query;
        if (!callback?.data) continue;

        const parsed = parseCallbackData(callback.data);
        if (!parsed) {
          await answerCallback(telegramConfig.botToken, callback.id, "Unknown action.");
          continue;
        }

        const { action, itemId } = parsed;

        const resolveFn = action === "approve" ? approve : reject;
        const result = await resolveFn(deployDir, itemId, {
          resolvedVia: "telegram",
          auditConfig,
        });

        if (result.success) {
          await answerCallback(
            telegramConfig.botToken,
            callback.id,
            action === "approve" ? "Approved." : "Rejected.",
          );

          // Update the message to remove buttons and show result
          const item = await getItem(deployDir, itemId);
          if (item && callback.message) {
            await sendResolutionConfirmation(
              telegramConfig,
              item,
              callback.message.message_id,
            );
          }

          onResolution?.(itemId, action === "approve" ? "approved" : "rejected");
        } else {
          await answerCallback(
            telegramConfig.botToken,
            callback.id,
            result.error ?? "Failed to resolve.",
          );
        }
      }
    } catch (err) {
      if (signal?.aborted) break;
      console.warn("[evolve] Telegram polling error:", err);
      await sleep(5000, signal);
    }
  }
}

// ── Telegram API Helpers ─────────────────────────────────────────────────────

async function getUpdates(
  botToken: string,
  offset: number,
  signal?: AbortSignal,
): Promise<TelegramUpdate[]> {
  const url = `https://api.telegram.org/bot${botToken}/getUpdates`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      offset,
      timeout: 30,
      allowed_updates: ["callback_query"],
    }),
    signal,
  });

  if (!response.ok) return [];

  const body = (await response.json()) as { ok?: boolean; result?: TelegramUpdate[] };
  return body.ok && body.result ? body.result : [];
}

async function answerCallback(
  botToken: string,
  callbackQueryId: string,
  text: string,
): Promise<void> {
  try {
    const url = `https://api.telegram.org/bot${botToken}/answerCallbackQuery`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
      }),
    });
  } catch (err) {
    console.warn("[evolve] Failed to answer Telegram callback:", err);
  }
}

// ── Parse Callback Data ──────────────────────────────────────────────────────

function parseCallbackData(data: string): { action: "approve" | "reject"; itemId: string } | null {
  const match = /^apv:(approve|reject):(.+)$/.exec(data);
  if (!match) return null;
  return { action: match[1] as "approve" | "reject", itemId: match[2] as string };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

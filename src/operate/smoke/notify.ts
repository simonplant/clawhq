/**
 * Telegram notification for smoke-test transitions. Uses the same
 * TELEGRAM_BOT_TOKEN the agent uses — the smoke runner is a peer
 * process, not the agent, so credentials are shared.
 *
 * Never throws — notification failure must not break the smoke run.
 */

const TELEGRAM_API_BASE = "https://api.telegram.org";

export interface NotifyOutcome {
  readonly sent: boolean;
  readonly error?: string;
}

/**
 * Send a Telegram message. Returns a result object; never throws.
 * `chatId` and `botToken` typically come from the deployment's .env.
 */
export async function notifyTelegram(
  botToken: string,
  chatId: string,
  message: string,
  signal?: AbortSignal,
): Promise<NotifyOutcome> {
  if (!botToken || !chatId || !message) {
    return { sent: false, error: "missing token, chatId, or message" };
  }

  try {
    const url = `${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`;
    const body = {
      chat_id: chatId,
      text: message,
      parse_mode: "Markdown" as const,
      disable_web_page_preview: true,
    };
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { sent: false, error: `HTTP ${response.status}: ${text.slice(0, 120)}` };
    }
    return { sent: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { sent: false, error: msg };
  }
}

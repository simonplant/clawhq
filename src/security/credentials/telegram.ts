/**
 * Credential probe for Telegram bot token.
 * Uses the getMe API call to verify the token.
 */

import type { CredentialProbe, CredResult } from "./types.js";

const TIMEOUT_MS = 10_000;

function telegramUrl(token: string): string {
  return `https://api.telegram.org/bot${token}/getMe`;
}

export const telegramProbe: CredentialProbe = {
  provider: "Telegram",
  envVar: "TELEGRAM_BOT_TOKEN",

  async check(apiKey: string): Promise<CredResult> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(telegramUrl(apiKey), {
        method: "GET",
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.status === 200) {
        return {
          provider: this.provider,
          status: "valid",
          message: "Bot token is valid",
        };
      }

      if (response.status === 401) {
        return {
          provider: this.provider,
          status: "failing",
          message: "Bot token is invalid or revoked",
        };
      }

      return {
        provider: this.provider,
        status: "error",
        message: `Unexpected status: ${response.status}`,
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return {
          provider: this.provider,
          status: "error",
          message: "Request timed out after 10s",
        };
      }
      return {
        provider: this.provider,
        status: "error",
        message: `Network error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};

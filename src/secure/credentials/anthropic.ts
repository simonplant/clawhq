/**
 * Credential probe for Anthropic API key.
 * Sends a HEAD-like request to the Anthropic API to verify the key.
 */

import type { CredentialProbe, CredResult } from "./types.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const TIMEOUT_MS = 10_000;

export const anthropicProbe: CredentialProbe = {
  provider: "Anthropic",
  envVar: "ANTHROPIC_API_KEY",

  async check(apiKey: string): Promise<CredResult> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      // 200 or 400 (bad request but auth passed) = valid key
      if (response.status === 200 || response.status === 400) {
        return {
          provider: this.provider,
          status: "valid",
          message: "API key is valid",
        };
      }

      if (response.status === 401) {
        return {
          provider: this.provider,
          status: "failing",
          message: "API key is invalid or revoked",
        };
      }

      if (response.status === 403) {
        return {
          provider: this.provider,
          status: "expired",
          message: "API key lacks permissions or account is suspended",
        };
      }

      // 429 means the key is valid but rate limited
      if (response.status === 429) {
        return {
          provider: this.provider,
          status: "valid",
          message: "API key is valid (rate limited)",
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

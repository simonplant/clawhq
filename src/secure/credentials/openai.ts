/**
 * Credential probe for OpenAI API key.
 * Lists models endpoint to verify the key without consuming tokens.
 */

import type { CredentialProbe, CredResult } from "./types.js";

const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const TIMEOUT_MS = 10_000;

export const openaiProbe: CredentialProbe = {
  provider: "OpenAI",
  envVar: "OPENAI_API_KEY",

  async check(apiKey: string): Promise<CredResult> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(OPENAI_MODELS_URL, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.status === 200) {
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

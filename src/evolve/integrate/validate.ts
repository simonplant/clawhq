/**
 * Live validation probes for integrations.
 *
 * Each integration has a validation function that checks credentials
 * are present and functional by making a lightweight API call.
 * Probes never throw — they return a result object.
 */

import { OLLAMA_DEFAULT_URL, WHATSAPP_API_BASE, WHATSAPP_API_VERSION } from "../../config/defaults.js";

import { getIntegrationDef } from "./registry.js";

/** Result of a validation probe. */
export interface ValidationResult {
  readonly ok: boolean;
  readonly message: string;
}

/**
 * Lightweight fetch with a short timeout. Never throws.
 */
async function probeFetch(
  url: string,
  init: RequestInit,
  timeoutMs = 10_000,
): Promise<{ response: Response } | { error: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    return { response };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { error: "Request timed out" };
    }
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Per-Integration Validators ─────────────────────────────────────────────

type Validator = (env: Record<string, string>) => Promise<ValidationResult>;

const validators: Record<string, Validator> = {
  anthropic: async (env) => {
    const key = env["ANTHROPIC_API_KEY"];
    if (!key) return { ok: false, message: "ANTHROPIC_API_KEY not set" };
    if (!key.startsWith("sk-ant-")) return { ok: false, message: "ANTHROPIC_API_KEY format invalid (expected sk-ant-... prefix)" };

    const result = await probeFetch("https://api.anthropic.com/v1/models", {
      method: "GET",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    });
    if ("error" in result) return { ok: false, message: `API unreachable: ${result.error}` };
    if (result.response.status === 200) return { ok: true, message: "Connected to Anthropic API" };
    if (result.response.status === 401) return { ok: false, message: "API key rejected (401)" };
    return { ok: false, message: `Unexpected status ${result.response.status}` };
  },

  openai: async (env) => {
    const key = env["OPENAI_API_KEY"];
    if (!key) return { ok: false, message: "OPENAI_API_KEY not set" };
    if (!key.startsWith("sk-")) return { ok: false, message: "OPENAI_API_KEY format invalid (expected sk-... prefix)" };

    const result = await probeFetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
    });
    if ("error" in result) return { ok: false, message: `API unreachable: ${result.error}` };
    if (result.response.status === 200) return { ok: true, message: "Connected to OpenAI API" };
    if (result.response.status === 401) return { ok: false, message: "API key rejected (401)" };
    return { ok: false, message: `Unexpected status ${result.response.status}` };
  },

  telegram: async (env) => {
    const token = env["TELEGRAM_BOT_TOKEN"];
    if (!token) return { ok: false, message: "TELEGRAM_BOT_TOKEN not set" };

    const result = await probeFetch(`https://api.telegram.org/bot${token}/getMe`, { method: "GET" });
    if ("error" in result) return { ok: false, message: `API unreachable: ${result.error}` };
    if (result.response.status === 200) {
      try {
        const body = (await result.response.json()) as { ok?: boolean; result?: { username?: string } };
        if (body.ok && body.result?.username) {
          return { ok: true, message: `Connected as @${body.result.username}` };
        }
      } catch (err) { console.warn("[evolve] Failed to parse Telegram API response:", err); }
      return { ok: true, message: "Connected to Telegram" };
    }
    if (result.response.status === 401) return { ok: false, message: "Bot token rejected (401)" };
    return { ok: false, message: `Unexpected status ${result.response.status}` };
  },

  ollama: async (env) => {
    const host = env["OLLAMA_HOST"] ?? OLLAMA_DEFAULT_URL;
    const result = await probeFetch(`${host}/api/tags`, { method: "GET" }, 5_000);
    if ("error" in result) return { ok: false, message: `Ollama unreachable at ${host}: ${result.error}` };
    if (result.response.status === 200) return { ok: true, message: `Connected to Ollama at ${host}` };
    return { ok: false, message: `Ollama responded with status ${result.response.status}` };
  },

  tavily: async (env) => {
    const key = env["TAVILY_API_KEY"];
    if (!key) return { ok: false, message: "TAVILY_API_KEY not set" };
    // Tavily doesn't have a simple health endpoint, validate key format
    if (key.length < 10) return { ok: false, message: "TAVILY_API_KEY appears too short" };
    return { ok: true, message: "Tavily API key configured (format ok)" };
  },

  whatsapp: async (env) => {
    const phoneId = env["WHATSAPP_PHONE_NUMBER_ID"];
    const token = env["WHATSAPP_ACCESS_TOKEN"];
    if (!phoneId || !token) return { ok: false, message: "WhatsApp credentials incomplete" };

    const result = await probeFetch(
      `${WHATSAPP_API_BASE}/${WHATSAPP_API_VERSION}/${phoneId}`,
      { method: "GET", headers: { Authorization: `Bearer ${token}` } },
    );
    if ("error" in result) return { ok: false, message: `API unreachable: ${result.error}` };
    if (result.response.status === 200) return { ok: true, message: "Connected to WhatsApp Business API" };
    if (result.response.status === 401) return { ok: false, message: "Access token rejected (401)" };
    return { ok: false, message: `Unexpected status ${result.response.status}` };
  },
};

// ── Generic Validator (for integrations without a specific probe) ─────────

async function genericValidator(name: string, env: Record<string, string>): Promise<ValidationResult> {
  const def = getIntegrationDef(name);
  if (!def) return { ok: false, message: `Unknown integration "${name}"` };

  // Check that at least the required env keys are set
  const missing = def.envKeys.filter((k) => !env[k.key] && !k.defaultValue);
  if (missing.length > 0) {
    return { ok: false, message: `Missing: ${missing.map((k) => k.key).join(", ")}` };
  }

  return { ok: true, message: `Credentials configured for ${def.label}` };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Validate an integration's credentials with a live probe.
 *
 * Uses a specific validator if available, falls back to generic check.
 */
export async function validateIntegration(
  name: string,
  env: Record<string, string>,
): Promise<ValidationResult> {
  const validator = validators[name.toLowerCase()];
  if (validator) return validator(env);
  return genericValidator(name, env);
}

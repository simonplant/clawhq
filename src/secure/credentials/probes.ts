/**
 * Built-in credential probes for common integrations.
 *
 * Each probe checks: (1) key is present, (2) key format is plausible,
 * (3) key actually works against the provider's API.
 *
 * Probes never throw — they return a ProbeResult with ok: false and
 * an actionable fix message on failure.
 */

import { CREDENTIALS_PROBE_TIMEOUT_MS } from "../../config/defaults.js";

import type { CredentialProbe, ProbeResult } from "./probe-types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a missing-key result. */
function missing(integration: string, envKey: string, fix: string): ProbeResult {
  return { integration, envKey, ok: false, message: "Not configured", fix };
}

/** Build a pass result. */
function pass(integration: string, envKey: string, message: string): ProbeResult {
  return { integration, envKey, ok: true, message };
}

/** Build a fail result. */
function fail(integration: string, envKey: string, message: string, fix: string): ProbeResult {
  return { integration, envKey, ok: false, message, fix };
}

/**
 * Lightweight fetch with a short timeout. Returns the response or an error message.
 * Never throws.
 */
async function probeFetch(
  url: string,
  init: RequestInit,
  timeoutMs = CREDENTIALS_PROBE_TIMEOUT_MS,
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
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

// ── Anthropic Probe ──────────────────────────────────────────────────────────

/**
 * Validate an Anthropic API key by calling the /v1/models endpoint.
 *
 * Key format: `sk-ant-api03-...` (prefix may vary with key version).
 */
export const probeAnthropic: CredentialProbe = async (env) => {
  const integration = "Anthropic";
  const envKey = "ANTHROPIC_API_KEY";
  const key = env[envKey];

  if (!key) {
    return missing(integration, envKey, `Set ${envKey} in your .env file. Get a key at https://console.anthropic.com/`);
  }

  if (!key.startsWith("sk-ant-")) {
    return fail(integration, envKey, "Key format invalid (expected sk-ant-... prefix)", `Check ${envKey} — it should start with sk-ant-`);
  }

  const result = await probeFetch("https://api.anthropic.com/v1/models", {
    method: "GET",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
  });

  if ("error" in result) {
    return fail(integration, envKey, `API unreachable: ${result.error}`, "Check your network connection or try again later");
  }

  const { response } = result;

  if (response.status === 200) {
    return pass(integration, envKey, "Valid");
  }

  if (response.status === 401) {
    return fail(integration, envKey, "Key rejected (401 Unauthorized)", `Regenerate ${envKey} at https://console.anthropic.com/`);
  }

  if (response.status === 403) {
    return fail(integration, envKey, "Key forbidden (403)", "Check API key permissions or account status at https://console.anthropic.com/");
  }

  return fail(integration, envKey, `Unexpected status ${response.status}`, "Check your Anthropic account status");
};

// ── OpenAI Probe ─────────────────────────────────────────────────────────────

/**
 * Validate an OpenAI API key by calling the /v1/models endpoint.
 *
 * Key format: `sk-...` (typically `sk-proj-...` for project keys).
 */
export const probeOpenAI: CredentialProbe = async (env) => {
  const integration = "OpenAI";
  const envKey = "OPENAI_API_KEY";
  const key = env[envKey];

  if (!key) {
    return missing(integration, envKey, `Set ${envKey} in your .env file. Get a key at https://platform.openai.com/api-keys`);
  }

  if (!key.startsWith("sk-")) {
    return fail(integration, envKey, "Key format invalid (expected sk-... prefix)", `Check ${envKey} — it should start with sk-`);
  }

  const result = await probeFetch("https://api.openai.com/v1/models", {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` },
  });

  if ("error" in result) {
    return fail(integration, envKey, `API unreachable: ${result.error}`, "Check your network connection or try again later");
  }

  const { response } = result;

  if (response.status === 200) {
    return pass(integration, envKey, "Valid");
  }

  if (response.status === 401) {
    return fail(integration, envKey, "Key rejected (401 Unauthorized)", `Regenerate ${envKey} at https://platform.openai.com/api-keys`);
  }

  if (response.status === 429) {
    return fail(integration, envKey, "Rate limited or quota exceeded (429)", "Check your OpenAI billing and usage limits at https://platform.openai.com/usage");
  }

  return fail(integration, envKey, `Unexpected status ${response.status}`, "Check your OpenAI account status");
};

// ── Telegram Probe ───────────────────────────────────────────────────────────

/**
 * Validate a Telegram Bot token by calling the /getMe endpoint.
 *
 * Token format: `<bot_id>:<alphanumeric_hash>` (e.g., 123456:ABC-DEF...).
 */
export const probeTelegram: CredentialProbe = async (env) => {
  const integration = "Telegram";
  const envKey = "TELEGRAM_BOT_TOKEN";
  const token = env[envKey];

  if (!token) {
    return missing(integration, envKey, `Set ${envKey} in your .env file. Create a bot via @BotFather on Telegram`);
  }

  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
    return fail(integration, envKey, "Token format invalid (expected <id>:<hash>)", `Check ${envKey} — format should be 123456789:ABCdefGHI...`);
  }

  const result = await probeFetch(`https://api.telegram.org/bot${token}/getMe`, {
    method: "GET",
  });

  if ("error" in result) {
    return fail(integration, envKey, `API unreachable: ${result.error}`, "Check your network connection or try again later");
  }

  const { response } = result;

  if (response.status === 200) {
    try {
      const body = (await response.json()) as { ok?: boolean; result?: { username?: string } };
      if (body.ok && body.result?.username) {
        return pass(integration, envKey, `Valid (@${body.result.username})`);
      }
    } catch (err) {
      console.warn("[secure/credentials] Failed to parse Telegram getMe response", err);
    }
    return pass(integration, envKey, "Valid");
  }

  if (response.status === 401) {
    return fail(integration, envKey, "Token rejected (401 Unauthorized)", `Regenerate token via @BotFather and update ${envKey}`);
  }

  return fail(integration, envKey, `Unexpected status ${response.status}`, "Check your bot token via @BotFather on Telegram");
};

// ── Probe Registry ───────────────────────────────────────────────────────────

/**
 * All built-in probes. New integrations are added here.
 *
 * The registry is an array rather than a map — probes run in order,
 * and an integration could have multiple probes if needed.
 */
export const builtinProbes: readonly CredentialProbe[] = [
  probeAnthropic,
  probeOpenAI,
  probeTelegram,
];

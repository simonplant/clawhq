/**
 * Integration tests for credential probes — run against real API endpoints.
 *
 * These tests validate that probes work against live services, catching
 * cases where an API changes its auth error response format.
 *
 * Environment variables control which probes run:
 *   ANTHROPIC_API_KEY        — Anthropic probe (valid key)
 *   OPENAI_API_KEY           — OpenAI probe (valid key)
 *   TELEGRAM_BOT_TOKEN       — Telegram probe (valid token)
 *   OP_SERVICE_ACCOUNT_TOKEN — 1Password probe (valid token)
 *
 * Ollama probe runs whenever a local Ollama instance is reachable.
 * All tests skip gracefully when credentials are not available.
 */

import { describe, expect, it } from "vitest";

import { OLLAMA_DEFAULT_URL, OLLAMA_PROBE_TIMEOUT_MS } from "../../config/defaults.js";

import { probe1Password, probeAnthropic, probeOpenAI, probeTelegram } from "./probes.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Check if a local Ollama instance is reachable. */
async function isOllamaReachable(baseUrl: string = OLLAMA_DEFAULT_URL): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(OLLAMA_PROBE_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Anthropic ───────────────────────────────────────────────────────────────

describe("probeAnthropic (live)", () => {
  const key = process.env["ANTHROPIC_API_KEY"];

  it.skipIf(!key)("returns valid:true for a real API key", async () => {
    const result = await probeAnthropic({ ANTHROPIC_API_KEY: key as string });
    expect(result.ok).toBe(true);
    expect(result.integration).toBe("Anthropic");
    expect(result.envKey).toBe("ANTHROPIC_API_KEY");
  });

  it.skipIf(!key)("returns valid:false for a bad key with correct prefix", async () => {
    const result = await probeAnthropic({ ANTHROPIC_API_KEY: "sk-ant-api03-bogus-key-that-should-fail" });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/401|403|Unauthorized|forbidden/i);
  });
});

// ── OpenAI ──────────────────────────────────────────────────────────────────

describe("probeOpenAI (live)", () => {
  const key = process.env["OPENAI_API_KEY"];

  it.skipIf(!key)("returns valid:true for a real API key", async () => {
    const result = await probeOpenAI({ OPENAI_API_KEY: key as string });
    expect(result.ok).toBe(true);
    expect(result.integration).toBe("OpenAI");
    expect(result.envKey).toBe("OPENAI_API_KEY");
  });

  it.skipIf(!key)("returns valid:false for a bad key with correct prefix", async () => {
    const result = await probeOpenAI({ OPENAI_API_KEY: "sk-bogus-key-that-should-fail" });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/401|429|Unauthorized|rate/i);
  });
});

// ── Telegram ────────────────────────────────────────────────────────────────

describe("probeTelegram (live)", () => {
  const token = process.env["TELEGRAM_BOT_TOKEN"];

  it.skipIf(!token)("returns valid:true for a real bot token", async () => {
    const result = await probeTelegram({ TELEGRAM_BOT_TOKEN: token as string });
    expect(result.ok).toBe(true);
    expect(result.integration).toBe("Telegram");
    expect(result.envKey).toBe("TELEGRAM_BOT_TOKEN");
    expect(result.message).toMatch(/Valid/);
  });

  it.skipIf(!token)("returns valid:false for a bad token with correct format", async () => {
    const result = await probeTelegram({ TELEGRAM_BOT_TOKEN: "000000000:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/401|Unauthorized/i);
  });
});

// ── 1Password ───────────────────────────────────────────────────────────────

describe("probe1Password (live)", () => {
  const token = process.env["OP_SERVICE_ACCOUNT_TOKEN"];

  it.skipIf(!token)("returns valid:true for a real service account token", async () => {
    const result = await probe1Password({ OP_SERVICE_ACCOUNT_TOKEN: token as string });
    expect(result.ok).toBe(true);
    expect(result.integration).toBe("1Password");
    expect(result.envKey).toBe("OP_SERVICE_ACCOUNT_TOKEN");
  });

  it.skipIf(!token)("returns valid:false for a structurally-broken token", async () => {
    const result = await probe1Password({ OP_SERVICE_ACCOUNT_TOKEN: "ops_bogus-token-that-should-fail" });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/envelope unreadable|401|403|Unauthorized|forbidden/i);
  });
});

// ── Ollama (local) ──────────────────────────────────────────────────────────

describe("Ollama probe (live, local)", () => {
  let ollamaAvailable = false;

  // Check Ollama availability once before all tests in this suite
  it("detects Ollama availability", async () => {
    ollamaAvailable = await isOllamaReachable();
    // This test always passes — it just records availability
    expect(typeof ollamaAvailable).toBe("boolean");
  });

  it("returns 200 from /api/tags when Ollama is running", async () => {
    if (!ollamaAvailable) {
      return; // skip silently — Ollama not installed
    }
    const res = await fetch(`${OLLAMA_DEFAULT_URL}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(OLLAMA_PROBE_TIMEOUT_MS),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models?: unknown[] };
    expect(body).toHaveProperty("models");
    expect(Array.isArray(body.models)).toBe(true);
  });

  it("returns valid model list structure from Ollama", async () => {
    if (!ollamaAvailable) {
      return; // skip silently — Ollama not installed
    }
    const res = await fetch(`${OLLAMA_DEFAULT_URL}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(OLLAMA_PROBE_TIMEOUT_MS),
    });
    const body = (await res.json()) as { models?: { name: string }[] };
    expect(Array.isArray(body.models)).toBe(true);
    for (const model of body.models ?? []) {
      expect(typeof model.name).toBe("string");
      expect(model.name.length).toBeGreaterThan(0);
    }
  });
});

// ── Graceful skip summary ───────────────────────────────────────────────────

describe("graceful skip behavior", () => {
  it("probes return not-configured for missing credentials (no crash, no network call)", async () => {
    // Run all probes with empty env — should all return ok:false with "Not configured"
    const results = await Promise.all([
      probeAnthropic({}),
      probeOpenAI({}),
      probeTelegram({}),
      probe1Password({}),
    ]);

    for (const result of results) {
      expect(result.ok).toBe(false);
      expect(result.message).toBe("Not configured");
      expect(result.fix).toBeDefined();
    }
  });
});

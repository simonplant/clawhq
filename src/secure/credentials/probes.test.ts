import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { probe1Password, probeAnthropic, probeOpenAI, probeTelegram } from "./probes.js";

// ── Fetch Mock ───────────────────────────────────────────────────────────────

let fetchMock: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;

beforeEach(() => {
  fetchMock = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Helper: create a minimal Response-like object. */
function mockResponse(status: number, body?: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

// ── Anthropic Probe ──────────────────────────────────────────────────────────

describe("probeAnthropic", () => {
  it("returns missing when key is absent", async () => {
    const result = await probeAnthropic({});
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Not configured");
    expect(result.envKey).toBe("ANTHROPIC_API_KEY");
    expect(result.fix).toContain("ANTHROPIC_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid key format", async () => {
    const result = await probeAnthropic({ ANTHROPIC_API_KEY: "bad-key" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("format invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes with valid key and 200 response", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { data: [] }));

    const result = await probeAnthropic({ ANTHROPIC_API_KEY: "sk-ant-api03-test" });
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Valid");
    expect(result.integration).toBe("Anthropic");
  });

  it("fails with 401 response", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(401));

    const result = await probeAnthropic({ ANTHROPIC_API_KEY: "sk-ant-api03-expired" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("401");
    expect(result.fix).toContain("Regenerate");
  });

  it("fails with 403 response", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(403));

    const result = await probeAnthropic({ ANTHROPIC_API_KEY: "sk-ant-api03-forbidden" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("403");
  });

  it("handles network errors gracefully", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await probeAnthropic({ ANTHROPIC_API_KEY: "sk-ant-api03-test" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("unreachable");
    expect(result.fix).toContain("network");
  });

  it("sends correct headers", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { data: [] }));

    await probeAnthropic({ ANTHROPIC_API_KEY: "sk-ant-api03-test" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/models");
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-api03-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });
});

// ── OpenAI Probe ─────────────────────────────────────────────────────────────

describe("probeOpenAI", () => {
  it("returns missing when key is absent", async () => {
    const result = await probeOpenAI({});
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Not configured");
    expect(result.envKey).toBe("OPENAI_API_KEY");
  });

  it("rejects invalid key format", async () => {
    const result = await probeOpenAI({ OPENAI_API_KEY: "not-a-key" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("format invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes with valid key and 200 response", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { data: [] }));

    const result = await probeOpenAI({ OPENAI_API_KEY: "sk-proj-test123" });
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Valid");
  });

  it("fails with 401 response", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(401));

    const result = await probeOpenAI({ OPENAI_API_KEY: "sk-expired" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("401");
    expect(result.fix).toContain("Regenerate");
  });

  it("fails with 429 response", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(429));

    const result = await probeOpenAI({ OPENAI_API_KEY: "sk-rate-limited" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("429");
    expect(result.fix).toContain("billing");
  });

  it("sends Authorization header with Bearer token", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { data: [] }));

    await probeOpenAI({ OPENAI_API_KEY: "sk-mykey" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/models");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-mykey");
  });
});

// ── Telegram Probe ───────────────────────────────────────────────────────────

describe("probeTelegram", () => {
  it("returns missing when token is absent", async () => {
    const result = await probeTelegram({});
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Not configured");
    expect(result.envKey).toBe("TELEGRAM_BOT_TOKEN");
  });

  it("rejects invalid token format", async () => {
    const result = await probeTelegram({ TELEGRAM_BOT_TOKEN: "bad-token" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("format invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes with valid token and shows username", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse(200, { ok: true, result: { username: "test_bot" } }),
    );

    const result = await probeTelegram({ TELEGRAM_BOT_TOKEN: "123456:ABCdef" });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("@test_bot");
  });

  it("passes with valid token even without username in response", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { ok: true, result: {} }));

    const result = await probeTelegram({ TELEGRAM_BOT_TOKEN: "123456:ABCdef" });
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Valid");
  });

  it("fails with 401 response", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(401));

    const result = await probeTelegram({ TELEGRAM_BOT_TOKEN: "999:expired" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("401");
    expect(result.fix).toContain("@BotFather");
  });

  it("uses correct Telegram API URL with token", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse(200, { ok: true, result: { username: "bot" } }),
    );

    await probeTelegram({ TELEGRAM_BOT_TOKEN: "123:ABC" });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bot123:ABC/getMe");
  });
});

// ── 1Password Probe ─────────────────────────────────────────────────────────

describe("probe1Password", () => {
  it("returns missing when token is absent", async () => {
    const result = await probe1Password({});
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Not configured");
    expect(result.envKey).toBe("OP_SERVICE_ACCOUNT_TOKEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid token format", async () => {
    const result = await probe1Password({ OP_SERVICE_ACCOUNT_TOKEN: "bad-token" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("format invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes with valid token and 200 response", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { items: [] }));

    const result = await probe1Password({ OP_SERVICE_ACCOUNT_TOKEN: "ops_test123abc" });
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Valid");
    expect(result.integration).toBe("1Password");
  });

  it("fails with 401 response", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(401));

    const result = await probe1Password({ OP_SERVICE_ACCOUNT_TOKEN: "ops_expired" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("401");
    expect(result.fix).toContain("Regenerate");
  });

  it("fails with 403 response", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(403));

    const result = await probe1Password({ OP_SERVICE_ACCOUNT_TOKEN: "ops_noaccess" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("403");
    expect(result.fix).toContain("vault");
  });

  it("handles network errors gracefully", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await probe1Password({ OP_SERVICE_ACCOUNT_TOKEN: "ops_test123abc" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("unreachable");
    expect(result.fix).toContain("network");
  });

  it("sends correct authorization header", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { items: [] }));

    await probe1Password({ OP_SERVICE_ACCOUNT_TOKEN: "ops_mytoken" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://events.1password.com/api/v1/auditevents");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer ops_mytoken");
  });
});

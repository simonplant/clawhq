import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { probe1Password, probeAnthropic, probeGitHub, probeHomeAssistant, probeOpenAI, probeTelegram, probeX } from "./probes.js";

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
  // Envelope: {signInAddress:"my.1password.com", ...} — personal tier
  const PERSONAL_TOKEN =
    "ops_eyJzaWduSW5BZGRyZXNzIjoibXkuMXBhc3N3b3JkLmNvbSIsInVzZXJBdXRoIjp7Im1ldGhvZCI6IlNSUGctNDA5NiJ9LCJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20ifQ";
  // Envelope: {signInAddress:"acme.1password.com", ...} — business tier
  const BUSINESS_TOKEN =
    "ops_eyJzaWduSW5BZGRyZXNzIjoiYWNtZS4xcGFzc3dvcmQuY29tIiwidXNlckF1dGgiOnsibWV0aG9kIjoiU1JQZy00MDk2In0sImVtYWlsIjoic2FAZXguY29tIn0";

  it("returns missing when token is absent", async () => {
    const result = await probe1Password({});
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Not configured");
    expect(result.envKey).toBe("OP_SERVICE_ACCOUNT_TOKEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid token format (missing ops_ prefix)", async () => {
    const result = await probe1Password({ OP_SERVICE_ACCOUNT_TOKEN: "bad-token" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("format invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unreadable envelope (garbage after ops_)", async () => {
    const result = await probe1Password({ OP_SERVICE_ACCOUNT_TOKEN: "ops_not-base64-json" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("envelope unreadable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes personal-tier token without live probe", async () => {
    const result = await probe1Password({ OP_SERVICE_ACCOUNT_TOKEN: PERSONAL_TOKEN });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Format valid");
    expect(result.message).toContain("my.1password.com");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes business-tier token with 200 response", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { items: [] }));
    const result = await probe1Password({ OP_SERVICE_ACCOUNT_TOKEN: BUSINESS_TOKEN });
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Valid");
  });

  it("fails business-tier token with 401 response", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(401));
    const result = await probe1Password({ OP_SERVICE_ACCOUNT_TOKEN: BUSINESS_TOKEN });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("401");
    expect(result.fix).toContain("Regenerate");
  });

  it("passes business-tier token with 403 (events grant missing) as format-valid", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(403));
    const result = await probe1Password({ OP_SERVICE_ACCOUNT_TOKEN: BUSINESS_TOKEN });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("events-reporter");
  });

  it("fails business-tier token when network is unreachable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await probe1Password({ OP_SERVICE_ACCOUNT_TOKEN: BUSINESS_TOKEN });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("unreachable");
    expect(result.fix).toContain("network");
  });

  it("sends correct authorization header for business-tier probe", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { items: [] }));
    await probe1Password({ OP_SERVICE_ACCOUNT_TOKEN: BUSINESS_TOKEN });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://events.1password.com/api/v1/auditevents");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bearer ${BUSINESS_TOKEN}`);
  });
});

// ── GitHub Probe ────────────────────────────────────────────────────────────

describe("probeGitHub", () => {
  it("returns missing when token is absent", async () => {
    const result = await probeGitHub({});
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Not configured");
    expect(result.envKey).toBe("GH_TOKEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid token format", async () => {
    const result = await probeGitHub({ GH_TOKEN: "bad-token" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("format invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes with valid classic token and shows login", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { login: "octocat" }));

    const result = await probeGitHub({ GH_TOKEN: "ghp_testtoken123" });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("@octocat");
  });

  it("passes with valid fine-grained token", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { login: "user" }));

    const result = await probeGitHub({ GH_TOKEN: "github_pat_testtoken" });
    expect(result.ok).toBe(true);
  });

  it("fails with 401 response", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(401));

    const result = await probeGitHub({ GH_TOKEN: "ghp_expired" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("401");
    expect(result.fix).toContain("Regenerate");
  });

  it("handles network errors gracefully", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await probeGitHub({ GH_TOKEN: "ghp_testtoken123" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("unreachable");
  });

  it("sends correct headers", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { login: "user" }));

    await probeGitHub({ GH_TOKEN: "ghp_mytoken" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/user");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer ghp_mytoken");
    expect(headers["Accept"]).toBe("application/vnd.github+json");
  });
});

// ── X/Twitter Probe ─────────────────────────────────────────────────────────

describe("probeX", () => {
  it("returns missing when token is absent", async () => {
    const result = await probeX({});
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Not configured");
    expect(result.envKey).toBe("X_BEARER_TOKEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes with valid token and 200 response", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { data: { id: "1" } }));

    const result = await probeX({ X_BEARER_TOKEN: "AAAAAAAAAtest" });
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Valid");
  });

  it("fails with 401 response", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(401));

    const result = await probeX({ X_BEARER_TOKEN: "expired" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("401");
  });

  it("fails with 403 response", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(403));

    const result = await probeX({ X_BEARER_TOKEN: "forbidden" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("403");
    expect(result.fix).toContain("access");
  });

  it("sends correct authorization header", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { data: {} }));

    await probeX({ X_BEARER_TOKEN: "mytoken" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.twitter.com/2/users/by/username/Twitter");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer mytoken");
  });
});

// ── Home Assistant Probe ────────────────────────────────────────────────────

describe("probeHomeAssistant", () => {
  it("returns missing when token is absent", async () => {
    const result = await probeHomeAssistant({});
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Not configured");
    expect(result.envKey).toBe("HA_TOKEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails when HA_URL is not set", async () => {
    const result = await probeHomeAssistant({ HA_TOKEN: "sometoken" });
    expect(result.ok).toBe(false);
    expect(result.envKey).toBe("HA_URL");
    expect(result.fix).toContain("HA_URL");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes with valid token and 200 response", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { message: "API running." }));

    const result = await probeHomeAssistant({ HA_TOKEN: "mytoken", HA_URL: "http://ha.local:8123" });
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Valid");
  });

  it("fails with 401 response", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(401));

    const result = await probeHomeAssistant({ HA_TOKEN: "expired", HA_URL: "http://ha.local:8123" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("401");
    expect(result.fix).toContain("Regenerate");
  });

  it("handles network errors gracefully", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await probeHomeAssistant({ HA_TOKEN: "mytoken", HA_URL: "http://ha.local:8123" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("unreachable");
    expect(result.fix).toContain("ha.local:8123");
  });

  it("sends correct headers and URL", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, {}));

    await probeHomeAssistant({ HA_TOKEN: "mytoken", HA_URL: "http://ha.local:8123" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://ha.local:8123/api/");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer mytoken");
  });
});

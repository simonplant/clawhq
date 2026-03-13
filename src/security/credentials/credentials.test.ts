import { describe, expect, it, vi } from "vitest";

import { parseEnv } from "../secrets/env.js";

import { anthropicProbe } from "./anthropic.js";
import { openaiProbe } from "./openai.js";
import { telegramProbe } from "./telegram.js";

import { formatCredTable, runProbes } from "./index.js";

// Mock global fetch for all probe tests
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("anthropicProbe", () => {
  it("returns valid on 200", async () => {
    mockFetch.mockResolvedValueOnce({ status: 200 });
    const result = await anthropicProbe.check("sk-ant-test-key");
    expect(result.status).toBe("valid");
    expect(result.provider).toBe("Anthropic");
  });

  it("returns failing on 401", async () => {
    mockFetch.mockResolvedValueOnce({ status: 401 });
    const result = await anthropicProbe.check("sk-ant-bad-key");
    expect(result.status).toBe("failing");
  });

  it("returns expired on 403", async () => {
    mockFetch.mockResolvedValueOnce({ status: 403 });
    const result = await anthropicProbe.check("sk-ant-expired");
    expect(result.status).toBe("expired");
  });

  it("returns valid on 429 (rate limited)", async () => {
    mockFetch.mockResolvedValueOnce({ status: 429 });
    const result = await anthropicProbe.check("sk-ant-limited");
    expect(result.status).toBe("valid");
  });

  it("returns error on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await anthropicProbe.check("sk-ant-test");
    expect(result.status).toBe("error");
    expect(result.message).toContain("Network error");
  });

  it("returns error on timeout", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    mockFetch.mockRejectedValueOnce(abortError);
    const result = await anthropicProbe.check("sk-ant-test");
    expect(result.status).toBe("error");
    expect(result.message).toContain("timed out");
  });
});

describe("openaiProbe", () => {
  it("returns valid on 200", async () => {
    mockFetch.mockResolvedValueOnce({ status: 200 });
    const result = await openaiProbe.check("sk-test-key");
    expect(result.status).toBe("valid");
    expect(result.provider).toBe("OpenAI");
  });

  it("returns failing on 401", async () => {
    mockFetch.mockResolvedValueOnce({ status: 401 });
    const result = await openaiProbe.check("sk-bad-key");
    expect(result.status).toBe("failing");
  });

  it("returns error on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await openaiProbe.check("sk-test");
    expect(result.status).toBe("error");
    expect(result.message).toContain("Network error");
  });
});

describe("telegramProbe", () => {
  it("returns valid on 200", async () => {
    mockFetch.mockResolvedValueOnce({ status: 200 });
    const result = await telegramProbe.check("123456789:ABCDEFtest");
    expect(result.status).toBe("valid");
    expect(result.provider).toBe("Telegram");
  });

  it("returns failing on 401", async () => {
    mockFetch.mockResolvedValueOnce({ status: 401 });
    const result = await telegramProbe.check("bad-token");
    expect(result.status).toBe("failing");
  });

  it("returns error on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await telegramProbe.check("123456789:test");
    expect(result.status).toBe("error");
  });
});

describe("runProbes", () => {
  it("reports missing for unconfigured credentials", async () => {
    const env = parseEnv("# empty");
    const report = await runProbes(env);

    expect(report.results).toHaveLength(3);
    expect(report.counts.missing).toBe(3);
    for (const r of report.results) {
      expect(r.status).toBe("missing");
    }
  });

  it("runs probes for configured credentials", async () => {
    mockFetch.mockResolvedValueOnce({ status: 200 }); // Anthropic
    mockFetch.mockResolvedValueOnce({ status: 401 }); // OpenAI

    const env = parseEnv(
      "ANTHROPIC_API_KEY=sk-ant-test\nOPENAI_API_KEY=sk-bad",
    );
    const report = await runProbes(env);

    expect(report.results).toHaveLength(3);
    expect(report.counts.valid).toBe(1);
    expect(report.counts.failing).toBe(1);
    expect(report.counts.missing).toBe(1); // Telegram
  });
});

describe("formatCredTable", () => {
  it("formats a report as a readable table", async () => {
    const env = parseEnv("# empty");
    const report = await runProbes(env);
    const table = formatCredTable(report);

    expect(table).toContain("PROVIDER");
    expect(table).toContain("STATUS");
    expect(table).toContain("Anthropic");
    expect(table).toContain("OpenAI");
    expect(table).toContain("Telegram");
    expect(table).toContain("SKIP");
    expect(table).toContain("0 configured");
  });
});

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseEnv } from "../secure/secrets/env.js";
import type { SecretEntry } from "../secure/secrets/types.js";

import { buildSecretList, formatAge, formatSecretsTable } from "./secrets.js";

// Mock fetch for credential probes
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("formatAge", () => {
  it("returns - for empty string", () => {
    expect(formatAge("")).toBe("-");
  });

  it("returns today for recent timestamps", () => {
    expect(formatAge(new Date().toISOString())).toBe("today");
  });

  it("returns days for recent past", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(formatAge(threeDaysAgo.toISOString())).toBe("3d");
  });

  it("returns months for older timestamps", () => {
    const twoMonthsAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    expect(formatAge(twoMonthsAgo.toISOString())).toBe("2mo");
  });
});

describe("formatSecretsTable", () => {
  it("shows message for empty list", () => {
    expect(formatSecretsTable([])).toBe("No secrets found in .env");
  });

  it("formats entries as table", () => {
    const entries: SecretEntry[] = [
      {
        name: "ANTHROPIC_API_KEY",
        provider_category: "ai",
        health_status: "valid",
        created_at: "2026-01-01T00:00:00.000Z",
        rotated_at: null,
      },
    ];

    const output = formatSecretsTable(entries);
    expect(output).toContain("ANTHROPIC_API_KEY");
    expect(output).toContain("ai");
    expect(output).toContain("VALID");
    expect(output).toContain("1 secret configured");
    // Must never contain actual values
    expect(output).not.toContain("sk-ant");
  });

  it("shows correct plural for multiple secrets", () => {
    const entries: SecretEntry[] = [
      {
        name: "KEY_A",
        provider_category: "api",
        health_status: "unknown",
        created_at: "",
        rotated_at: null,
      },
      {
        name: "KEY_B",
        provider_category: "api",
        health_status: "unknown",
        created_at: "",
        rotated_at: null,
      },
    ];

    const output = formatSecretsTable(entries);
    expect(output).toContain("2 secrets configured");
  });
});

describe("buildSecretList", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "secrets-test-"));
    mockFetch.mockReset();
  });

  it("builds list from .env entries", async () => {
    const metaPath = join(tmpDir, ".env.meta");
    const meta = {
      ANTHROPIC_API_KEY: {
        created_at: "2026-01-15T00:00:00.000Z",
        rotated_at: null,
        provider_category: "ai",
      },
    };
    await writeFile(metaPath, JSON.stringify(meta));

    const env = parseEnv("ANTHROPIC_API_KEY=sk-ant-test\nMY_CUSTOM=hello");

    // Mock fetch for Anthropic probe
    mockFetch.mockResolvedValueOnce({ status: 200 }); // Anthropic
    mockFetch.mockResolvedValueOnce({ status: 401 }); // OpenAI (missing key)
    mockFetch.mockResolvedValueOnce({ status: 401 }); // Telegram (missing key)

    const entries = await buildSecretList(env, metaPath);

    expect(entries).toHaveLength(2);
    expect(entries[0].name).toBe("ANTHROPIC_API_KEY");
    expect(entries[0].provider_category).toBe("ai");
    expect(entries[0].created_at).toBe("2026-01-15T00:00:00.000Z");

    expect(entries[1].name).toBe("MY_CUSTOM");
    expect(entries[1].provider_category).toBe("other");
  });

  it("handles missing metadata gracefully", async () => {
    const metaPath = join(tmpDir, "nonexistent.meta");
    const env = parseEnv("SOME_KEY=value");

    const entries = await buildSecretList(env, metaPath);

    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("SOME_KEY");
    expect(entries[0].provider_category).toBe("api"); // inferred from KEY pattern
    expect(entries[0].health_status).toBe("unknown");
    expect(entries[0].created_at).toBe("");
  });
});

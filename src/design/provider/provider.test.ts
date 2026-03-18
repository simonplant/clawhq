import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addProvider,
  formatProviderTable,
  formatTestResult,
  getConfiguredDomains,
  listProviders,
  loadRegistry,
  removeProvider,
  saveRegistry,
  testProvider,
  validateKeyFormat,
} from "./provider.js";
import { findProvider, getProvidersByCategory, KNOWN_PROVIDERS, listKnownProviderIds } from "./registry.js";
import type { ProviderConfig, ProviderRegistry, TestProviderResult } from "./types.js";
import { ProviderError } from "./types.js";

// --- Mock fs ---
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  chmod: vi.fn(),
  stat: vi.fn(),
}));

// --- Mock secrets ---
vi.mock("../../secure/secrets/permissions.js", () => ({
  enforceEnvPermissions: vi.fn(),
}));

const fsMocks = await import("node:fs/promises") as unknown as {
  readFile: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
};

// Mock fetch for provider tests
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Registry (known providers) ---

describe("KNOWN_PROVIDERS", () => {
  it("has entries for major LLM providers", () => {
    const ids = KNOWN_PROVIDERS.map((p) => p.id);
    expect(ids).toContain("anthropic");
    expect(ids).toContain("openai");
    expect(ids).toContain("google");
    expect(ids).toContain("ollama");
  });

  it("each provider has required fields", () => {
    for (const p of KNOWN_PROVIDERS) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.category).toBeTruthy();
      expect(p.envVar).toBeTruthy();
      expect(Array.isArray(p.domains)).toBe(true);
    }
  });

  it("ollama has no external domains", () => {
    const ollama = KNOWN_PROVIDERS.find((p) => p.id === "ollama");
    expect(ollama?.domains).toHaveLength(0);
  });
});

describe("findProvider", () => {
  it("finds known providers by id", () => {
    const p = findProvider("anthropic");
    expect(p).toBeDefined();
    expect(p?.label).toBe("Anthropic");
  });

  it("returns undefined for unknown providers", () => {
    expect(findProvider("nonexistent")).toBeUndefined();
  });
});

describe("listKnownProviderIds", () => {
  it("returns all provider ids", () => {
    const ids = listKnownProviderIds();
    expect(ids).toContain("anthropic");
    expect(ids).toContain("openai");
    expect(ids.length).toBe(KNOWN_PROVIDERS.length);
  });
});

describe("getProvidersByCategory", () => {
  it("groups providers by category", () => {
    const grouped = getProvidersByCategory();
    expect(grouped.llm).toBeDefined();
    expect(grouped.llm.length).toBeGreaterThan(0);
    expect(grouped.llm.every((p) => p.category === "llm")).toBe(true);
  });
});

// --- validateKeyFormat ---

describe("validateKeyFormat", () => {
  it("returns null for valid Anthropic key", () => {
    expect(validateKeyFormat("anthropic", "sk-ant-abc123")).toBeNull();
  });

  it("returns error for invalid Anthropic key format", () => {
    const result = validateKeyFormat("anthropic", "invalid-key");
    expect(result).toBeTruthy();
    expect(result).toContain("does not match");
  });

  it("returns null for unknown provider (skips validation)", () => {
    expect(validateKeyFormat("unknown", "anything")).toBeNull();
  });

  it("returns null for provider without key pattern", () => {
    // Mistral has no keyPattern defined
    expect(validateKeyFormat("mistral", "anything")).toBeNull();
  });

  it("validates OpenAI key prefix", () => {
    expect(validateKeyFormat("openai", "sk-abc123")).toBeNull();
    expect(validateKeyFormat("openai", "bad-key")).toBeTruthy();
  });
});

// --- loadRegistry / saveRegistry ---

describe("loadRegistry", () => {
  it("returns empty registry when file doesn't exist", async () => {
    fsMocks.readFile.mockRejectedValueOnce(new Error("ENOENT"));
    const registry = await loadRegistry("/home/test");
    expect(registry.providers).toHaveLength(0);
  });

  it("parses existing registry file", async () => {
    const data: ProviderRegistry = {
      providers: [
        {
          id: "anthropic",
          label: "Anthropic",
          category: "llm",
          envVar: "ANTHROPIC_API_KEY",
          domains: ["api.anthropic.com"],
          status: "active",
          addedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    };
    fsMocks.readFile.mockResolvedValueOnce(JSON.stringify(data));
    const registry = await loadRegistry("/home/test");
    expect(registry.providers).toHaveLength(1);
    expect(registry.providers[0].id).toBe("anthropic");
  });
});

describe("saveRegistry", () => {
  it("writes registry as formatted JSON", async () => {
    fsMocks.writeFile.mockResolvedValueOnce(undefined);
    await saveRegistry("/home/test", { providers: [] });
    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      "/home/test/providers.json",
      expect.stringContaining("providers"),
      "utf-8",
    );
  });
});

// --- addProvider ---

describe("addProvider", () => {
  it("throws for unknown provider", async () => {
    await expect(
      addProvider("/home/test", "nonexistent", "key123"),
    ).rejects.toThrow(ProviderError);
  });

  it("throws for invalid key format", async () => {
    await expect(
      addProvider("/home/test", "anthropic", "bad-key"),
    ).rejects.toThrow(ProviderError);
  });

  it("adds provider with valid key", async () => {
    // readFile for .env — file doesn't exist
    fsMocks.readFile
      .mockRejectedValueOnce(new Error("ENOENT")) // .env
      .mockRejectedValueOnce(new Error("ENOENT")); // providers.json
    fsMocks.writeFile.mockResolvedValue(undefined);

    const result = await addProvider("/home/test", "anthropic", "sk-ant-test123");

    expect(result.provider.id).toBe("anthropic");
    expect(result.credentialStored).toBe(true);
    expect(result.domainsAdded).toContain("api.anthropic.com");
  });

  it("updates existing provider entry", async () => {
    const existingRegistry: ProviderRegistry = {
      providers: [
        {
          id: "anthropic",
          label: "Anthropic",
          category: "llm",
          envVar: "ANTHROPIC_API_KEY",
          domains: ["api.anthropic.com"],
          status: "active",
          addedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    };

    fsMocks.readFile
      .mockRejectedValueOnce(new Error("ENOENT")) // .env
      .mockResolvedValueOnce(JSON.stringify(existingRegistry)); // providers.json
    fsMocks.writeFile.mockResolvedValue(undefined);

    const result = await addProvider("/home/test", "anthropic", "sk-ant-newkey");
    // Should preserve original addedAt
    expect(result.provider.addedAt).toBe("2025-01-01T00:00:00.000Z");
  });
});

// --- listProviders ---

describe("listProviders", () => {
  it("returns empty list when no providers configured", async () => {
    fsMocks.readFile.mockRejectedValueOnce(new Error("ENOENT")); // providers.json
    const providers = await listProviders("/home/test");
    expect(providers).toHaveLength(0);
  });

  it("marks providers with missing credentials", async () => {
    const registry: ProviderRegistry = {
      providers: [
        {
          id: "anthropic",
          label: "Anthropic",
          category: "llm",
          envVar: "ANTHROPIC_API_KEY",
          domains: ["api.anthropic.com"],
          status: "active",
          addedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    };
    fsMocks.readFile
      .mockResolvedValueOnce(JSON.stringify(registry)) // providers.json
      .mockResolvedValueOnce("# empty env"); // .env

    const providers = await listProviders("/home/test");
    expect(providers[0].status).toBe("no-credential");
  });

  it("marks providers with present credentials as active", async () => {
    const registry: ProviderRegistry = {
      providers: [
        {
          id: "anthropic",
          label: "Anthropic",
          category: "llm",
          envVar: "ANTHROPIC_API_KEY",
          domains: ["api.anthropic.com"],
          status: "active",
          addedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    };
    fsMocks.readFile
      .mockResolvedValueOnce(JSON.stringify(registry)) // providers.json
      .mockResolvedValueOnce("ANTHROPIC_API_KEY=sk-ant-test"); // .env

    const providers = await listProviders("/home/test");
    expect(providers[0].status).toBe("active");
  });
});

// --- removeProvider ---

describe("removeProvider", () => {
  it("throws when provider is not configured", async () => {
    fsMocks.readFile.mockRejectedValueOnce(new Error("ENOENT")); // providers.json
    await expect(removeProvider("/home/test", "anthropic")).rejects.toThrow(
      ProviderError,
    );
  });

  it("removes provider and credential", async () => {
    const registry: ProviderRegistry = {
      providers: [
        {
          id: "anthropic",
          label: "Anthropic",
          category: "llm",
          envVar: "ANTHROPIC_API_KEY",
          domains: ["api.anthropic.com"],
          status: "active",
          addedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    };
    fsMocks.readFile
      .mockResolvedValueOnce(JSON.stringify(registry)) // providers.json
      .mockResolvedValueOnce("ANTHROPIC_API_KEY=sk-ant-test"); // .env
    fsMocks.writeFile.mockResolvedValue(undefined);

    const result = await removeProvider("/home/test", "anthropic");

    expect(result.id).toBe("anthropic");
    expect(result.credentialRemoved).toBe(true);
    expect(result.domainsRemoved).toContain("api.anthropic.com");
  });

  it("handles missing .env gracefully", async () => {
    const registry: ProviderRegistry = {
      providers: [
        {
          id: "anthropic",
          label: "Anthropic",
          category: "llm",
          envVar: "ANTHROPIC_API_KEY",
          domains: ["api.anthropic.com"],
          status: "active",
          addedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    };
    fsMocks.readFile
      .mockResolvedValueOnce(JSON.stringify(registry)) // providers.json
      .mockRejectedValueOnce(new Error("ENOENT")); // .env
    fsMocks.writeFile.mockResolvedValue(undefined);

    const result = await removeProvider("/home/test", "anthropic");
    expect(result.credentialRemoved).toBe(false);
  });
});

// --- testProvider ---

describe("testProvider", () => {
  it("throws for unknown provider", async () => {
    await expect(testProvider("/home/test", "nonexistent")).rejects.toThrow(
      ProviderError,
    );
  });

  it("returns missing when credential not configured", async () => {
    fsMocks.readFile.mockRejectedValueOnce(new Error("ENOENT")); // .env
    const result = await testProvider("/home/test", "anthropic");
    expect(result.status).toBe("missing");
    expect(result.message).toContain("not configured");
  });

  it("returns valid on 200 response", async () => {
    fsMocks.readFile.mockResolvedValueOnce("ANTHROPIC_API_KEY=sk-ant-test"); // .env
    mockFetch.mockResolvedValueOnce({ status: 200 });

    const result = await testProvider("/home/test", "anthropic");
    expect(result.status).toBe("valid");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("returns failing on 401 response", async () => {
    fsMocks.readFile.mockResolvedValueOnce("OPENAI_API_KEY=sk-bad"); // .env
    mockFetch.mockResolvedValueOnce({ status: 401 });

    const result = await testProvider("/home/test", "openai");
    expect(result.status).toBe("failing");
  });

  it("returns expired on 403 response", async () => {
    fsMocks.readFile.mockResolvedValueOnce("OPENAI_API_KEY=sk-expired"); // .env
    mockFetch.mockResolvedValueOnce({ status: 403 });

    const result = await testProvider("/home/test", "openai");
    expect(result.status).toBe("expired");
  });

  it("returns valid on 429 (rate limited)", async () => {
    fsMocks.readFile.mockResolvedValueOnce("ANTHROPIC_API_KEY=sk-ant-test"); // .env
    mockFetch.mockResolvedValueOnce({ status: 429 });

    const result = await testProvider("/home/test", "anthropic");
    expect(result.status).toBe("valid");
    expect(result.message).toContain("rate limited");
  });

  it("returns error on network failure", async () => {
    fsMocks.readFile.mockResolvedValueOnce("ANTHROPIC_API_KEY=sk-ant-test"); // .env
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await testProvider("/home/test", "anthropic");
    expect(result.status).toBe("error");
    expect(result.message).toContain("Network error");
  });

  it("returns error on timeout", async () => {
    fsMocks.readFile.mockResolvedValueOnce("ANTHROPIC_API_KEY=sk-ant-test"); // .env
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    mockFetch.mockRejectedValueOnce(abortError);

    const result = await testProvider("/home/test", "anthropic");
    expect(result.status).toBe("error");
    expect(result.message).toContain("timed out");
  });

  it("skips credential check for local providers", async () => {
    fsMocks.readFile.mockRejectedValueOnce(new Error("ENOENT")); // .env
    mockFetch.mockResolvedValueOnce({ status: 200 });

    const result = await testProvider("/home/test", "ollama");
    // ollama is category "local", so missing credential is OK
    expect(result.status).toBe("valid");
  });
});

// --- formatProviderTable ---

describe("formatProviderTable", () => {
  it("shows message when no providers configured", () => {
    const table = formatProviderTable([]);
    expect(table).toContain("No providers configured");
  });

  it("formats providers as a readable table", () => {
    const providers: ProviderConfig[] = [
      {
        id: "anthropic",
        label: "Anthropic",
        category: "llm",
        envVar: "ANTHROPIC_API_KEY",
        domains: ["api.anthropic.com"],
        status: "active",
        addedAt: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "ollama",
        label: "Ollama",
        category: "local",
        envVar: "OLLAMA_HOST",
        domains: [],
        status: "active",
        addedAt: "2025-01-01T00:00:00.000Z",
      },
    ];

    const table = formatProviderTable(providers);
    expect(table).toContain("ID");
    expect(table).toContain("LABEL");
    expect(table).toContain("CATEGORY");
    expect(table).toContain("STATUS");
    expect(table).toContain("anthropic");
    expect(table).toContain("Anthropic");
    expect(table).toContain("ACTIVE");
    expect(table).toContain("api.anthropic.com");
    expect(table).toContain("(local)");
    expect(table).toContain("2 providers configured");
  });
});

// --- formatTestResult ---

describe("formatTestResult", () => {
  it("formats a valid test result", () => {
    const result: TestProviderResult = {
      id: "anthropic",
      label: "Anthropic",
      status: "valid",
      message: "API key is valid",
      latencyMs: 142,
    };
    const formatted = formatTestResult(result);
    expect(formatted).toContain("PASS");
    expect(formatted).toContain("Anthropic");
    expect(formatted).toContain("142ms");
  });

  it("formats a failing test result", () => {
    const result: TestProviderResult = {
      id: "openai",
      label: "OpenAI",
      status: "failing",
      message: "API key is invalid",
      latencyMs: 50,
    };
    const formatted = formatTestResult(result);
    expect(formatted).toContain("FAIL");
    expect(formatted).toContain("OpenAI");
  });
});

// --- getConfiguredDomains ---

describe("getConfiguredDomains", () => {
  it("returns empty array when no providers", async () => {
    fsMocks.readFile.mockRejectedValueOnce(new Error("ENOENT"));
    const domains = await getConfiguredDomains("/home/test");
    expect(domains).toHaveLength(0);
  });

  it("returns domains from configured providers", async () => {
    const registry: ProviderRegistry = {
      providers: [
        {
          id: "anthropic",
          label: "Anthropic",
          category: "llm",
          envVar: "ANTHROPIC_API_KEY",
          domains: ["api.anthropic.com"],
          status: "active",
          addedAt: "2025-01-01T00:00:00.000Z",
        },
        {
          id: "openai",
          label: "OpenAI",
          category: "llm",
          envVar: "OPENAI_API_KEY",
          domains: ["api.openai.com"],
          status: "active",
          addedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    };
    fsMocks.readFile.mockResolvedValueOnce(JSON.stringify(registry));

    const domains = await getConfiguredDomains("/home/test");
    expect(domains).toContain("api.anthropic.com");
    expect(domains).toContain("api.openai.com");
  });

  it("deduplicates domains", async () => {
    const registry: ProviderRegistry = {
      providers: [
        {
          id: "p1",
          label: "P1",
          category: "llm",
          envVar: "P1_KEY",
          domains: ["shared.example.com"],
          status: "active",
          addedAt: "2025-01-01T00:00:00.000Z",
        },
        {
          id: "p2",
          label: "P2",
          category: "llm",
          envVar: "P2_KEY",
          domains: ["shared.example.com"],
          status: "active",
          addedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    };
    fsMocks.readFile.mockResolvedValueOnce(JSON.stringify(registry));

    const domains = await getConfiguredDomains("/home/test");
    expect(domains).toHaveLength(1);
    expect(domains[0]).toBe("shared.example.com");
  });
});

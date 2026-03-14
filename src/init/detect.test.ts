import { beforeAll, describe, expect, it } from "vitest";

import {
  discoverFromEmail,
  discoverOllamaModels,
  isOllamaAvailable,
  suggestRouting,
  runDetection,
  type FetchFn,
} from "./detect.js";
import { getBuiltInTemplates } from "./templates.js";
import type { DiscoveredModel, TemplateChoice } from "./types.js";

let TEMPLATES: TemplateChoice[];

beforeAll(async () => {
  TEMPLATES = await getBuiltInTemplates();
});

// --- Helpers ---

function getTemplate(id: string): TemplateChoice {
  const t = TEMPLATES.find((t) => t.id === id);
  if (!t) throw new Error(`Template ${id} not found`);
  return t;
}

function mockFetchOllama(models: Array<{ name: string; size: number; details?: { parameter_size?: string } }>): FetchFn {
  return async (_url: string) => ({
    ok: true,
    json: async () => ({ models }),
  });
}

function mockFetchFail(): FetchFn {
  return async () => {
    throw new Error("Connection refused");
  };
}

function mockFetchNotOk(): FetchFn {
  return async () => ({
    ok: false,
    json: async () => ({}),
  });
}

// --- Email provider discovery ---

describe("discoverFromEmail", () => {
  it("detects iCloud email and suggests calendar + tasks", () => {
    const result = discoverFromEmail("user@icloud.com");
    expect(result).not.toBeNull();
    expect(result?.provider).toBe("icloud");
    expect(result?.calendar).toContain("iCloud");
    expect(result?.tasks).toContain("Reminders");
  });

  it("detects Gmail and suggests Google Calendar + Tasks", () => {
    const result = discoverFromEmail("user@gmail.com");
    expect(result).not.toBeNull();
    expect(result?.provider).toBe("google");
    expect(result?.calendar).toContain("Google Calendar");
    expect(result?.tasks).toContain("Google Tasks");
  });

  it("detects Outlook and suggests Outlook Calendar + To Do", () => {
    const result = discoverFromEmail("user@outlook.com");
    expect(result).not.toBeNull();
    expect(result?.provider).toBe("microsoft");
    expect(result?.calendar).toContain("Outlook");
    expect(result?.tasks).toContain("To Do");
  });

  it("detects me.com as iCloud", () => {
    const result = discoverFromEmail("user@me.com");
    expect(result).not.toBeNull();
    expect(result?.provider).toBe("icloud");
  });

  it("detects hotmail.com as Microsoft", () => {
    const result = discoverFromEmail("user@hotmail.com");
    expect(result).not.toBeNull();
    expect(result?.provider).toBe("microsoft");
  });

  it("detects proton.me", () => {
    const result = discoverFromEmail("user@proton.me");
    expect(result).not.toBeNull();
    expect(result?.provider).toBe("proton");
    expect(result?.calendar).toContain("Proton");
  });

  it("returns null for unknown domains", () => {
    expect(discoverFromEmail("user@mycustomdomain.com")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(discoverFromEmail("")).toBeNull();
  });

  it("returns null for invalid email", () => {
    expect(discoverFromEmail("not-an-email")).toBeNull();
  });

  it("is case-insensitive for domain", () => {
    const result = discoverFromEmail("User@Gmail.COM");
    expect(result).not.toBeNull();
    expect(result?.provider).toBe("google");
  });
});

// --- Ollama model discovery ---

describe("discoverOllamaModels", () => {
  it("discovers models from Ollama API", async () => {
    const fetch = mockFetchOllama([
      { name: "llama3:8b", size: 4_000_000_000, details: { parameter_size: "8B" } },
      { name: "mistral:7b", size: 3_800_000_000, details: { parameter_size: "7B" } },
    ]);

    const models = await discoverOllamaModels(fetch);
    expect(models).toHaveLength(2);
    expect(models[0].name).toBe("llama3:8b");
    expect(models[0].parameterSize).toBe("8B");
    expect(models[1].name).toBe("mistral:7b");
  });

  it("assesses capabilities based on parameter size", async () => {
    const fetch = mockFetchOllama([
      { name: "llama3:70b", size: 40_000_000_000, details: { parameter_size: "70B" } },
    ]);

    const models = await discoverOllamaModels(fetch);
    expect(models[0].capabilities.reasoning).toBe("high");
    expect(models[0].capabilities.longContext).toBe(true);
  });

  it("identifies code-specialized models", async () => {
    const fetch = mockFetchOllama([
      { name: "deepseek-coder:6.7b", size: 3_600_000_000, details: { parameter_size: "7B" } },
    ]);

    const models = await discoverOllamaModels(fetch);
    expect(models[0].capabilities.coding).toBe("medium");
  });

  it("returns empty array when Ollama is not running", async () => {
    const models = await discoverOllamaModels(mockFetchFail());
    expect(models).toHaveLength(0);
  });

  it("returns empty array when API returns error", async () => {
    const models = await discoverOllamaModels(mockFetchNotOk());
    expect(models).toHaveLength(0);
  });

  it("handles missing details gracefully", async () => {
    const fetch = mockFetchOllama([
      { name: "llama3:8b", size: 4_000_000_000 },
    ]);

    const models = await discoverOllamaModels(fetch);
    expect(models).toHaveLength(1);
    expect(models[0].parameterSize).toBe("8B"); // inferred from name
  });

  it("infers parameter size from model name when details missing", async () => {
    const fetch = mockFetchOllama([
      { name: "qwen2:72b", size: 40_000_000_000 },
    ]);

    const models = await discoverOllamaModels(fetch);
    expect(models[0].parameterSize).toBe("72B");
  });
});

describe("isOllamaAvailable", () => {
  it("returns true when Ollama API responds", async () => {
    const fetch = mockFetchOllama([]);
    expect(await isOllamaAvailable(fetch)).toBe(true);
  });

  it("returns false when Ollama is unreachable", async () => {
    expect(await isOllamaAvailable(mockFetchFail())).toBe(false);
  });
});

// --- Routing suggestions ---

describe("suggestRouting", () => {
  it("suggests cloud for all categories when no models available", () => {
    const template = getTemplate("replace-google-assistant");
    const suggestions = suggestRouting([], template);

    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(s.cloudNeeded).toBe(true);
    }
  });

  it("suggests local models when large model available", () => {
    const template = getTemplate("replace-google-assistant");
    const models: DiscoveredModel[] = [
      {
        name: "llama3:70b",
        sizeBytes: 40_000_000_000,
        parameterSize: "70B",
        capabilities: { reasoning: "high", coding: "medium", longContext: true },
      },
    ];

    const suggestions = suggestRouting(models, template);
    // A 70B model should handle most tasks locally
    const cloudNeeded = suggestions.filter((s) => s.cloudNeeded);
    expect(cloudNeeded.length).toBe(0);
  });

  it("recommends cloud for coding when only small general model", () => {
    const template = getTemplate("replace-google-assistant");
    const models: DiscoveredModel[] = [
      {
        name: "phi3:3b",
        sizeBytes: 1_800_000_000,
        parameterSize: "3B",
        capabilities: { reasoning: "low", coding: "low", longContext: false },
      },
    ];

    const suggestions = suggestRouting(models, template);
    const codingSuggestion = suggestions.find((s) => s.category === "coding");
    expect(codingSuggestion?.cloudNeeded).toBe(true);
  });

  it("prefers code-specialized models for coding tasks", () => {
    const template = getTemplate("replace-google-assistant");
    const models: DiscoveredModel[] = [
      {
        name: "llama3:8b",
        sizeBytes: 4_000_000_000,
        parameterSize: "8B",
        capabilities: { reasoning: "medium", coding: "low", longContext: true },
      },
      {
        name: "deepseek-coder:6.7b",
        sizeBytes: 3_600_000_000,
        parameterSize: "7B",
        capabilities: { reasoning: "medium", coding: "medium", longContext: true },
      },
    ];

    const suggestions = suggestRouting(models, template);
    const codingSuggestion = suggestions.find((s) => s.category === "coding");
    expect(codingSuggestion?.suggestedModel).toBe("deepseek-coder:6.7b");
    expect(codingSuggestion?.cloudNeeded).toBe(false);
  });

  it("uses smaller models for email/calendar tasks", () => {
    const template = getTemplate("replace-google-assistant");
    const models: DiscoveredModel[] = [
      {
        name: "llama3:70b",
        sizeBytes: 40_000_000_000,
        parameterSize: "70B",
        capabilities: { reasoning: "high", coding: "medium", longContext: true },
      },
      {
        name: "llama3:8b",
        sizeBytes: 4_000_000_000,
        parameterSize: "8B",
        capabilities: { reasoning: "medium", coding: "low", longContext: true },
      },
    ];

    const suggestions = suggestRouting(models, template);
    const emailSuggestion = suggestions.find((s) => s.category === "email");
    // Should prefer the smaller model for simple email tasks
    expect(emailSuggestion?.suggestedModel).toBe("llama3:8b");
    expect(emailSuggestion?.cloudNeeded).toBe(false);
  });

  it("covers all task categories", () => {
    const template = getTemplate("replace-google-assistant");
    const suggestions = suggestRouting([], template);
    const categories = suggestions.map((s) => s.category);
    expect(categories).toContain("email");
    expect(categories).toContain("calendar");
    expect(categories).toContain("research");
    expect(categories).toContain("writing");
    expect(categories).toContain("coding");
  });
});

// --- Full detection orchestrator ---

describe("runDetection", () => {
  it("combines email discovery and Ollama detection", async () => {
    const fetch = mockFetchOllama([
      { name: "llama3:8b", size: 4_000_000_000, details: { parameter_size: "8B" } },
    ]);
    const template = getTemplate("replace-google-assistant");

    const result = await runDetection("user@gmail.com", template, fetch);

    expect(result.discoveredIntegrations).not.toBeNull();
    expect(result.discoveredIntegrations?.provider).toBe("google");
    expect(result.ollamaModels).toHaveLength(1);
    expect(result.ollamaAvailable).toBe(true);
    expect(result.routingSuggestions.length).toBeGreaterThan(0);
  });

  it("works with no email provided", async () => {
    const fetch = mockFetchOllama([]);
    const template = getTemplate("replace-google-assistant");

    const result = await runDetection(undefined, template, fetch);

    expect(result.discoveredIntegrations).toBeNull();
    expect(result.ollamaAvailable).toBe(true);
  });

  it("handles Ollama being unavailable", async () => {
    const template = getTemplate("replace-google-assistant");

    const result = await runDetection("user@icloud.com", template, mockFetchFail());

    expect(result.discoveredIntegrations).not.toBeNull();
    expect(result.ollamaModels).toHaveLength(0);
    expect(result.ollamaAvailable).toBe(false);
    // Should suggest cloud for all categories
    for (const s of result.routingSuggestions) {
      expect(s.cloudNeeded).toBe(true);
    }
  });
});

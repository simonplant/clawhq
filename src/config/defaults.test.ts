import { describe, expect, it } from "vitest";

import { KNOWN_MODELS } from "./defaults.js";

describe("KNOWN_MODELS", () => {
  it("contains all expected model families", () => {
    const models = [...KNOWN_MODELS];

    // Anthropic Claude family
    expect(models.some((m) => m.includes("haiku"))).toBe(true);
    expect(models.some((m) => m.includes("sonnet"))).toBe(true);
    expect(models.some((m) => m.includes("opus"))).toBe(true);

    // OpenAI family
    expect(models.some((m) => m.startsWith("gpt-4"))).toBe(true);

    // Local / Ollama
    expect(models.some((m) => m.startsWith("gemma4"))).toBe(true);
  });

  it("is a ReadonlySet", () => {
    // Verify it behaves as a Set (has .has() method)
    expect(KNOWN_MODELS.has("haiku")).toBe(true);
    expect(KNOWN_MODELS.has("nonexistent-model")).toBe(false);
  });
});

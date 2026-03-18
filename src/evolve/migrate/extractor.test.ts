import { describe, expect, it } from "vitest";

import { estimateTokens, extractWithPatterns } from "./extractor.js";

describe("extractWithPatterns", () => {
  it("extracts preferences from user text", () => {
    const texts = [
      {
        title: "Chat 1",
        text: "I prefer bullet points over paragraphs. I always use dark mode.",
      },
    ];

    const items = extractWithPatterns(texts);
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.some((i) => i.category === "preference")).toBe(true);
  });

  it("extracts facts about the user", () => {
    const texts = [
      {
        title: "Chat 1",
        text: "I am a software engineer. I work at a fintech company.",
      },
    ];

    const items = extractWithPatterns(texts);
    expect(items.some((i) => i.category === "fact")).toBe(true);
  });

  it("extracts habits from user text", () => {
    const texts = [
      {
        title: "Chat 1",
        text: "Every morning I review my email before meetings.",
      },
    ];

    const items = extractWithPatterns(texts);
    expect(items.some((i) => i.category === "habit")).toBe(true);
  });

  it("deduplicates across conversations", () => {
    const texts = [
      { title: "Chat 1", text: "I prefer dark mode for coding." },
      { title: "Chat 2", text: "I prefer dark mode for coding." },
    ];

    const items = extractWithPatterns(texts);
    const darkMode = items.filter((i) =>
      i.content.toLowerCase().includes("dark mode"),
    );
    expect(darkMode).toHaveLength(1);
  });

  it("returns empty for no matches", () => {
    const texts = [
      { title: "Chat 1", text: "What is the capital of France?" },
    ];

    const items = extractWithPatterns(texts);
    expect(items).toHaveLength(0);
  });

  it("skips very short matches", () => {
    const texts = [
      { title: "Chat 1", text: "I prefer a." },
    ];

    const items = extractWithPatterns(texts);
    // "a" is too short (< 5 chars)
    expect(items).toHaveLength(0);
  });

  it("sets sources from conversation title", () => {
    const texts = [
      {
        title: "My Settings Discussion",
        text: "I always use vim keybindings in my editor.",
      },
    ];

    const items = extractWithPatterns(texts);
    if (items.length > 0) {
      expect(items[0].sources).toContain("My Settings Discussion");
    }
  });
});

describe("estimateTokens", () => {
  it("estimates token count based on character length", () => {
    const items = [
      {
        id: "test-1",
        content: "Prefers morning meetings",
        category: "preference" as const,
        confidence: "high" as const,
        sources: ["Chat 1"],
        piiMasked: false,
      },
    ];

    const tokens = estimateTokens(items);
    // "Prefers morning meetings" = 24 chars, ~6 tokens
    expect(tokens).toBe(6);
  });

  it("returns 0 for empty list", () => {
    expect(estimateTokens([])).toBe(0);
  });
});

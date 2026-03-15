import { describe, expect, it } from "vitest";

import { maskExtractedItems, scanForPII } from "./pii.js";
import type { ExtractedItem } from "./types.js";

describe("scanForPII", () => {
  it("detects and masks email addresses", () => {
    const result = scanForPII("Contact me at john@example.com for details");
    expect(result.hasPII).toBe(true);
    expect(result.matches).toContainEqual({ pattern: "Email address", count: 1 });
    expect(result.maskedContent).toContain("[EMAIL]");
    expect(result.maskedContent).not.toContain("john@example.com");
  });

  it("detects and masks phone numbers", () => {
    const result = scanForPII("Call me at 555-123-4567");
    expect(result.hasPII).toBe(true);
    expect(result.matches).toContainEqual({ pattern: "Phone number", count: 1 });
    expect(result.maskedContent).toContain("[PHONE]");
  });

  it("detects and masks SSN", () => {
    const result = scanForPII("My SSN is 123-45-6789");
    expect(result.hasPII).toBe(true);
    expect(result.matches).toContainEqual({ pattern: "SSN", count: 1 });
    expect(result.maskedContent).toContain("[SSN]");
  });

  it("detects and masks credit card numbers", () => {
    const result = scanForPII("Card number 4111 1111 1111 1111");
    expect(result.hasPII).toBe(true);
    expect(result.maskedContent).toContain("[CARD]");
  });

  it("detects and masks person names", () => {
    const result = scanForPII("My colleague John Smith handles that");
    expect(result.hasPII).toBe(true);
    expect(result.maskedContent).toContain("[NAME]");
  });

  it("returns no PII for clean text", () => {
    const result = scanForPII("Prefers morning meetings over afternoon ones");
    expect(result.hasPII).toBe(false);
    expect(result.matches).toHaveLength(0);
    expect(result.maskedContent).toBe("Prefers morning meetings over afternoon ones");
  });

  it("handles multiple PII types in one string", () => {
    const result = scanForPII("Email john@example.com, call 555-123-4567");
    expect(result.hasPII).toBe(true);
    expect(result.matches.length).toBeGreaterThanOrEqual(2);
    expect(result.maskedContent).toContain("[EMAIL]");
    expect(result.maskedContent).toContain("[PHONE]");
  });
});

describe("maskExtractedItems", () => {
  it("masks PII in extracted items and sets flag", () => {
    const items: ExtractedItem[] = [
      {
        id: "test-1",
        content: "Works with John Smith at acme@corp.com",
        category: "relationship",
        confidence: "medium",
        sources: ["Chat 1"],
        piiMasked: false,
      },
      {
        id: "test-2",
        content: "Prefers dark mode",
        category: "preference",
        confidence: "high",
        sources: ["Chat 2"],
        piiMasked: false,
      },
    ];

    const result = maskExtractedItems(items);
    expect(result.itemsWithPII).toBe(1);
    expect(result.totalPIIFound).toBeGreaterThanOrEqual(1);

    // First item should be masked
    expect(result.items[0].piiMasked).toBe(true);
    expect(result.items[0].content).toContain("[NAME]");

    // Second item should be untouched
    expect(result.items[1].piiMasked).toBe(false);
    expect(result.items[1].content).toBe("Prefers dark mode");
  });

  it("handles empty list", () => {
    const result = maskExtractedItems([]);
    expect(result.items).toHaveLength(0);
    expect(result.totalPIIFound).toBe(0);
    expect(result.itemsWithPII).toBe(0);
  });
});

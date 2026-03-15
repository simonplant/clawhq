import { describe, expect, it } from "vitest";

import { formatItem, reviewItems } from "./review.js";
import type { ExtractedItem, MigrateIO } from "./types.js";

function makeItem(overrides: Partial<ExtractedItem> = {}): ExtractedItem {
  return {
    id: "test-1",
    content: "Prefers morning meetings",
    category: "preference",
    confidence: "high",
    sources: ["Chat 1"],
    piiMasked: false,
    ...overrides,
  };
}

/** Create a mock IO that returns predefined answers. */
function mockIO(answers: string[]): MigrateIO {
  let idx = 0;
  const output: string[] = [];
  return {
    print(message: string): void {
      output.push(message);
    },
    prompt(_question: string): Promise<string> {
      return Promise.resolve(answers[idx++] ?? "a");
    },
  };
}

describe("formatItem", () => {
  it("formats a preference item with index", () => {
    const item = makeItem();
    const formatted = formatItem(item, 0, 5);
    expect(formatted).toContain("[1/5]");
    expect(formatted).toContain("PREFERENCE");
    expect(formatted).toContain("high");
    expect(formatted).toContain("Prefers morning meetings");
  });

  it("shows PII masked flag", () => {
    const item = makeItem({ piiMasked: true });
    const formatted = formatItem(item, 0, 1);
    expect(formatted).toContain("[PII masked]");
  });

  it("shows source information", () => {
    const item = makeItem({ sources: ["My Chat", "Other Chat"] });
    const formatted = formatItem(item, 0, 1);
    expect(formatted).toContain("My Chat");
    expect(formatted).toContain("Other Chat");
  });

  it("truncates many sources", () => {
    const item = makeItem({
      sources: ["Chat 1", "Chat 2", "Chat 3", "Chat 4", "Chat 5"],
    });
    const formatted = formatItem(item, 0, 1);
    expect(formatted).toContain("+2 more");
  });
});

describe("reviewItems", () => {
  it("approves items when user enters 'a'", async () => {
    const items = [makeItem(), makeItem({ id: "test-2" })];
    const io = mockIO(["a", "a"]);

    const results = await reviewItems(items, io);
    expect(results).toHaveLength(2);
    expect(results[0].decision).toBe("approve");
    expect(results[1].decision).toBe("approve");
  });

  it("rejects items when user enters 'r'", async () => {
    const items = [makeItem()];
    const io = mockIO(["r"]);

    const results = await reviewItems(items, io);
    expect(results[0].decision).toBe("reject");
  });

  it("handles edit with new content", async () => {
    const items = [makeItem()];
    const io = mockIO(["e", "Updated content here"]);

    const results = await reviewItems(items, io);
    expect(results[0].decision).toBe("edit");
    expect(results[0].editedContent).toBe("Updated content here");
  });

  it("approves all remaining with 'A'", async () => {
    const items = [
      makeItem({ id: "t1" }),
      makeItem({ id: "t2" }),
      makeItem({ id: "t3" }),
    ];
    const io = mockIO(["r", "A"]);

    const results = await reviewItems(items, io);
    expect(results).toHaveLength(3);
    expect(results[0].decision).toBe("reject");
    expect(results[1].decision).toBe("approve");
    expect(results[2].decision).toBe("approve");
  });

  it("rejects all remaining with 'R'", async () => {
    const items = [
      makeItem({ id: "t1" }),
      makeItem({ id: "t2" }),
      makeItem({ id: "t3" }),
    ];
    const io = mockIO(["a", "R"]);

    const results = await reviewItems(items, io);
    expect(results).toHaveLength(3);
    expect(results[0].decision).toBe("approve");
    expect(results[1].decision).toBe("reject");
    expect(results[2].decision).toBe("reject");
  });

  it("handles empty item list", async () => {
    const io = mockIO([]);
    const results = await reviewItems([], io);
    expect(results).toHaveLength(0);
  });
});

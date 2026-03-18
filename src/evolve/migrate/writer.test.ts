import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ExtractedItem, ReviewedItem } from "./types.js";
import { appendToUserMd, generateUserMdSection, writeToWarmMemory } from "./writer.js";

function makeItem(overrides: Partial<ExtractedItem> = {}): ExtractedItem {
  return {
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    content: "Prefers morning meetings",
    category: "preference",
    confidence: "high",
    sources: ["Chat 1"],
    piiMasked: false,
    ...overrides,
  };
}

function approved(item: ExtractedItem): ReviewedItem {
  return { item, decision: "approve" };
}

function rejected(item: ExtractedItem): ReviewedItem {
  return { item, decision: "reject" };
}

function edited(item: ExtractedItem, content: string): ReviewedItem {
  return { item, decision: "edit", editedContent: content };
}

describe("generateUserMdSection", () => {
  it("generates markdown with categorized items", () => {
    const items: ReviewedItem[] = [
      approved(makeItem({ content: "Likes bullet points", category: "preference" })),
      approved(makeItem({ content: "Works in finance", category: "fact" })),
      approved(makeItem({ content: "Checks email daily", category: "habit" })),
    ];

    const section = generateUserMdSection(items);
    expect(section).toContain("## Imported from ChatGPT");
    expect(section).toContain("### Preferences");
    expect(section).toContain("- Likes bullet points");
    expect(section).toContain("### Facts");
    expect(section).toContain("- Works in finance");
    expect(section).toContain("### Habits");
    expect(section).toContain("- Checks email daily");
  });

  it("uses edited content for edited items", () => {
    const items: ReviewedItem[] = [
      edited(makeItem({ content: "Original" }), "Edited content here"),
    ];

    const section = generateUserMdSection(items);
    expect(section).toContain("- Edited content here");
    expect(section).not.toContain("- Original");
  });

  it("skips rejected items", () => {
    const items: ReviewedItem[] = [
      approved(makeItem({ content: "Keep this" })),
      rejected(makeItem({ content: "Drop this" })),
    ];

    const section = generateUserMdSection(items);
    expect(section).toContain("Keep this");
    expect(section).not.toContain("Drop this");
  });

  it("returns empty string when all rejected", () => {
    const items: ReviewedItem[] = [
      rejected(makeItem()),
    ];

    const section = generateUserMdSection(items);
    expect(section).toBe("");
  });
});

describe("appendToUserMd", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-writer-${Date.now()}`);
    await mkdir(join(tmpDir, "workspace"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates USER.md when it doesn't exist", async () => {
    const items: ReviewedItem[] = [
      approved(makeItem({ content: "Prefers dark mode" })),
    ];

    const count = await appendToUserMd(tmpDir, items);
    expect(count).toBe(1);

    const content = await readFile(join(tmpDir, "workspace", "USER.md"), "utf-8");
    expect(content).toContain("Prefers dark mode");
  });

  it("appends to existing USER.md", async () => {
    const userMdPath = join(tmpDir, "workspace", "USER.md");
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(userMdPath, "# Existing Content\n\nSome stuff.\n", "utf-8");

    const items: ReviewedItem[] = [
      approved(makeItem({ content: "New preference" })),
    ];

    const count = await appendToUserMd(tmpDir, items);
    expect(count).toBe(1);

    const content = await readFile(userMdPath, "utf-8");
    expect(content).toContain("# Existing Content");
    expect(content).toContain("New preference");
  });

  it("returns 0 when all items are rejected", async () => {
    const items: ReviewedItem[] = [rejected(makeItem())];
    const count = await appendToUserMd(tmpDir, items);
    expect(count).toBe(0);
  });

  it("throws when token budget is already exceeded", async () => {
    const userMdPath = join(tmpDir, "workspace", "USER.md");
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(userMdPath, "x".repeat(100), "utf-8");

    const items: ReviewedItem[] = [
      approved(makeItem({ content: "Something new" })),
    ];

    await expect(appendToUserMd(tmpDir, items, 50)).rejects.toThrow(
      "USER.md already at token budget",
    );
  });
});

describe("writeToWarmMemory", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-memory-${Date.now()}`);
    await mkdir(join(tmpDir, "workspace", "memory", "warm"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes preference items to warm memory", async () => {
    const items: ReviewedItem[] = [
      approved(makeItem({ id: "mig-test-pref", content: "Likes mornings", category: "preference" })),
    ];

    const count = await writeToWarmMemory(tmpDir, items);
    expect(count).toBe(1);

    const files = await readdir(join(tmpDir, "workspace", "memory", "warm"));
    expect(files.length).toBe(1);

    const content = await readFile(
      join(tmpDir, "workspace", "memory", "warm", files[0]),
      "utf-8",
    );
    const entry = JSON.parse(content);
    expect(entry.category).toBe("preferences");
    expect(entry.content).toBe("Likes mornings");
    expect(entry.sourceRef).toContain("chatgpt-import:");
  });

  it("writes fact items as context entries", async () => {
    const items: ReviewedItem[] = [
      approved(makeItem({ id: "mig-test-fact", content: "Software engineer", category: "fact" })),
    ];

    const count = await writeToWarmMemory(tmpDir, items);
    expect(count).toBe(1);

    const files = await readdir(join(tmpDir, "workspace", "memory", "warm"));
    const content = await readFile(
      join(tmpDir, "workspace", "memory", "warm", files[0]),
      "utf-8",
    );
    const entry = JSON.parse(content);
    expect(entry.category).toBe("context");
  });

  it("writes relationship items with entities", async () => {
    const items: ReviewedItem[] = [
      approved(makeItem({
        id: "mig-test-rel",
        content: "colleague works with engineering",
        category: "relationship",
      })),
    ];

    const count = await writeToWarmMemory(tmpDir, items);
    expect(count).toBe(1);

    const files = await readdir(join(tmpDir, "workspace", "memory", "warm"));
    const content = await readFile(
      join(tmpDir, "workspace", "memory", "warm", files[0]),
      "utf-8",
    );
    const entry = JSON.parse(content);
    expect(entry.category).toBe("relationships");
    expect(entry.entities).toBeDefined();
  });

  it("skips rejected items", async () => {
    const items: ReviewedItem[] = [rejected(makeItem())];
    const count = await writeToWarmMemory(tmpDir, items);
    expect(count).toBe(0);
  });

  it("uses edited content for edited items", async () => {
    const items: ReviewedItem[] = [
      edited(makeItem({ id: "mig-test-edit" }), "Edited preference"),
    ];

    const count = await writeToWarmMemory(tmpDir, items);
    expect(count).toBe(1);

    const files = await readdir(join(tmpDir, "workspace", "memory", "warm"));
    const content = await readFile(
      join(tmpDir, "workspace", "memory", "warm", files[0]),
      "utf-8",
    );
    const entry = JSON.parse(content);
    expect(entry.content).toBe("Edited preference");
  });
});

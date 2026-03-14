import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listEntries, writeEntry } from "./store.js";
import {
  cleanupCold,
  fallbackSummarize,
  maskPII,
  runAllTransitions,
  transitionHotToWarm,
  transitionWarmToCold,
} from "./transitions.js";
import type { PreferenceEntry, TierPolicy } from "./types.js";

function makeEntry(overrides: Partial<PreferenceEntry> = {}): PreferenceEntry {
  return {
    id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    category: "preferences",
    content: "test preference content that is reasonably long for summarization testing purposes",
    tags: ["test"],
    confidence: "medium",
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    sourceRef: "session-1",
    parentId: null,
    ...overrides,
  };
}

const SHORT_POLICY: TierPolicy = {
  hotMaxBytes: 100 * 1024,
  hotMaxDays: 1,
  warmMaxDays: 2,
  deleteColdBeyondMax: true,
  coldMaxDays: 3,
};

describe("maskPII", () => {
  it("masks email addresses", () => {
    expect(maskPII("Contact john@example.com for details")).toBe("Contact [EMAIL] for details");
  });

  it("masks phone numbers", () => {
    expect(maskPII("Call 555-123-4567 for support")).toBe("Call [PHONE] for support");
  });

  it("masks SSN patterns", () => {
    expect(maskPII("SSN is 123-45-6789")).toBe("SSN is [SSN]");
  });

  it("masks credit card numbers", () => {
    expect(maskPII("Card 4111 1111 1111 1111 on file")).toBe("Card [CARD] on file");
  });

  it("leaves clean text unchanged", () => {
    expect(maskPII("no sensitive data here")).toBe("no sensitive data here");
  });
});

describe("fallbackSummarize", () => {
  it("returns short text unchanged", () => {
    expect(fallbackSummarize("short text")).toBe("short text");
  });

  it("truncates at first sentence for long text", () => {
    const text = "First sentence here. Second sentence with more detail. Third sentence.";
    const result = fallbackSummarize(text);
    expect(result).toBe("First sentence here.");
  });

  it("truncates at 200 chars for text without sentence boundaries", () => {
    const text = "a".repeat(300);
    const result = fallbackSummarize(text);
    expect(result.length).toBe(200);
    expect(result.endsWith("...")).toBe(true);
  });
});

describe("transitionHotToWarm", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `memory-trans-${Date.now()}`);
    await mkdir(join(tmpDir, "workspace", "memory", "hot"), { recursive: true });
    await mkdir(join(tmpDir, "workspace", "memory", "warm"), { recursive: true });
    await mkdir(join(tmpDir, "workspace", "memory", "cold"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("moves old hot entries to warm tier", async () => {
    const oldEntry = makeEntry({
      id: "mem-old-hot",
      createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await writeEntry(tmpDir, "hot", oldEntry);

    const result = await transitionHotToWarm(tmpDir, { policy: SHORT_POLICY });
    expect(result.moved).toBe(1);

    const hotEntries = await listEntries(tmpDir, "hot");
    expect(hotEntries).toHaveLength(0);

    const warmEntries = await listEntries(tmpDir, "warm");
    expect(warmEntries).toHaveLength(1);
    expect(warmEntries[0].id).toBe("mem-old-hot");
  });

  it("leaves fresh hot entries in place", async () => {
    const freshEntry = makeEntry({ id: "mem-fresh" });
    await writeEntry(tmpDir, "hot", freshEntry);

    const result = await transitionHotToWarm(tmpDir, { policy: SHORT_POLICY });
    expect(result.moved).toBe(0);

    const hotEntries = await listEntries(tmpDir, "hot");
    expect(hotEntries).toHaveLength(1);
  });

  it("uses custom summarizer", async () => {
    const oldEntry = makeEntry({
      id: "mem-summarize",
      content: "long content that should be summarized by the custom function",
      createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await writeEntry(tmpDir, "hot", oldEntry);

    const summarizer = async (text: string) => `SUMMARY: ${text.slice(0, 10)}`;
    const result = await transitionHotToWarm(tmpDir, {
      policy: SHORT_POLICY,
      summarizer,
    });

    expect(result.summarized).toBe(1);
    const warmEntries = await listEntries(tmpDir, "warm");
    expect(warmEntries[0].content).toMatch(/^SUMMARY:/);
  });
});

describe("transitionWarmToCold", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `memory-w2c-${Date.now()}`);
    await mkdir(join(tmpDir, "workspace", "memory", "hot"), { recursive: true });
    await mkdir(join(tmpDir, "workspace", "memory", "warm"), { recursive: true });
    await mkdir(join(tmpDir, "workspace", "memory", "cold"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("moves old warm entries to cold with PII masking", async () => {
    const oldEntry = makeEntry({
      id: "mem-warm-old",
      content: "Contact john@example.com about the project",
      createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await writeEntry(tmpDir, "warm", oldEntry);

    const result = await transitionWarmToCold(tmpDir, { policy: SHORT_POLICY });
    expect(result.moved).toBe(1);
    expect(result.piiMasked).toBe(1);

    const coldEntries = await listEntries(tmpDir, "cold");
    expect(coldEntries).toHaveLength(1);
    expect(coldEntries[0].content).toContain("[EMAIL]");
    expect(coldEntries[0].content).not.toContain("john@example.com");
  });
});

describe("cleanupCold", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `memory-cold-${Date.now()}`);
    await mkdir(join(tmpDir, "workspace", "memory", "hot"), { recursive: true });
    await mkdir(join(tmpDir, "workspace", "memory", "warm"), { recursive: true });
    await mkdir(join(tmpDir, "workspace", "memory", "cold"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("deletes cold entries beyond max age", async () => {
    const veryOld = makeEntry({
      id: "mem-very-old",
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await writeEntry(tmpDir, "cold", veryOld);

    const result = await cleanupCold(tmpDir, SHORT_POLICY);
    expect(result.deleted).toBe(1);

    const coldEntries = await listEntries(tmpDir, "cold");
    expect(coldEntries).toHaveLength(0);
  });

  it("does nothing when deleteColdBeyondMax is false", async () => {
    const veryOld = makeEntry({
      id: "mem-keep",
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await writeEntry(tmpDir, "cold", veryOld);

    const result = await cleanupCold(tmpDir, { ...SHORT_POLICY, deleteColdBeyondMax: false });
    expect(result.deleted).toBe(0);
  });
});

describe("runAllTransitions", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `memory-all-${Date.now()}`);
    await mkdir(join(tmpDir, "workspace", "memory", "hot"), { recursive: true });
    await mkdir(join(tmpDir, "workspace", "memory", "warm"), { recursive: true });
    await mkdir(join(tmpDir, "workspace", "memory", "cold"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("runs all transitions in sequence", async () => {
    // Hot entry that's old enough to transition
    await writeEntry(tmpDir, "hot", makeEntry({
      id: "mem-h",
      createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    }));
    // Warm entry that's old enough to transition
    await writeEntry(tmpDir, "warm", makeEntry({
      id: "mem-w",
      createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    }));

    const result = await runAllTransitions(tmpDir, { policy: SHORT_POLICY });
    // Hot entry moves to warm, then both warm entries (original + just-moved) move to cold
    expect(result.moved).toBe(3);
  });
});

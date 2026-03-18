import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  collectMemoryHealth,
  deleteEntry,
  entryAgeDays,
  findTransitionCandidates,
  listEntries,
  readEntry,
  tierSize,
  writeEntry,
} from "./store.js";
import type { PreferenceEntry } from "./types.js";

function makeEntry(overrides: Partial<PreferenceEntry> = {}): PreferenceEntry {
  return {
    id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    category: "preferences",
    content: "test preference content",
    tags: ["test"],
    confidence: "medium",
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    sourceRef: "session-1",
    parentId: null,
    ...overrides,
  };
}

describe("store", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `memory-store-${Date.now()}`);
    await mkdir(join(tmpDir, "workspace", "memory", "hot"), { recursive: true });
    await mkdir(join(tmpDir, "workspace", "memory", "warm"), { recursive: true });
    await mkdir(join(tmpDir, "workspace", "memory", "cold"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes and reads an entry", async () => {
    const entry = makeEntry({ id: "mem-test-1" });
    await writeEntry(tmpDir, "hot", entry);
    const read = await readEntry(tmpDir, "hot", "mem-test-1");

    expect(read).not.toBeNull();
    expect(read?.id).toBe("mem-test-1");
    expect(read?.content).toBe("test preference content");
  });

  it("returns null for missing entry", async () => {
    const read = await readEntry(tmpDir, "hot", "nonexistent");
    expect(read).toBeNull();
  });

  it("lists all entries in a tier", async () => {
    await writeEntry(tmpDir, "hot", makeEntry({ id: "mem-a" }));
    await writeEntry(tmpDir, "hot", makeEntry({ id: "mem-b" }));
    await writeEntry(tmpDir, "warm", makeEntry({ id: "mem-c" }));

    const hotEntries = await listEntries(tmpDir, "hot");
    expect(hotEntries).toHaveLength(2);

    const warmEntries = await listEntries(tmpDir, "warm");
    expect(warmEntries).toHaveLength(1);
  });

  it("deletes an entry", async () => {
    const entry = makeEntry({ id: "mem-delete" });
    await writeEntry(tmpDir, "hot", entry);

    const deleted = await deleteEntry(tmpDir, "hot", "mem-delete");
    expect(deleted).toBe(true);

    const read = await readEntry(tmpDir, "hot", "mem-delete");
    expect(read).toBeNull();
  });

  it("returns false when deleting nonexistent entry", async () => {
    const deleted = await deleteEntry(tmpDir, "hot", "nonexistent");
    expect(deleted).toBe(false);
  });

  it("calculates tier size", async () => {
    await writeEntry(tmpDir, "hot", makeEntry({ id: "mem-size-1" }));
    await writeEntry(tmpDir, "hot", makeEntry({ id: "mem-size-2" }));

    const { sizeBytes, fileCount } = await tierSize(tmpDir, "hot");
    expect(fileCount).toBe(2);
    expect(sizeBytes).toBeGreaterThan(0);
  });

  it("handles empty tier gracefully", async () => {
    const entries = await listEntries(tmpDir, "cold");
    expect(entries).toHaveLength(0);

    const { sizeBytes, fileCount } = await tierSize(tmpDir, "cold");
    expect(sizeBytes).toBe(0);
    expect(fileCount).toBe(0);
  });
});

describe("entryAgeDays", () => {
  it("calculates age in days", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const entry = makeEntry({ createdAt: threeDaysAgo.toISOString() });
    expect(entryAgeDays(entry)).toBe(3);
  });

  it("returns 0 for today's entry", () => {
    const entry = makeEntry();
    expect(entryAgeDays(entry)).toBe(0);
  });
});

describe("findTransitionCandidates", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `memory-transition-${Date.now()}`);
    await mkdir(join(tmpDir, "workspace", "memory", "hot"), { recursive: true });
    await mkdir(join(tmpDir, "workspace", "memory", "warm"), { recursive: true });
    await mkdir(join(tmpDir, "workspace", "memory", "cold"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("finds hot entries older than hotMaxDays", async () => {
    const oldEntry = makeEntry({
      id: "mem-old",
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const newEntry = makeEntry({ id: "mem-new" });

    await writeEntry(tmpDir, "hot", oldEntry);
    await writeEntry(tmpDir, "hot", newEntry);

    const candidates = await findTransitionCandidates(tmpDir, "hot");
    expect(candidates.some((c) => c.id === "mem-old")).toBe(true);
  });

  it("finds warm entries older than warmMaxDays", async () => {
    const oldEntry = makeEntry({
      id: "mem-warm-old",
      createdAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await writeEntry(tmpDir, "warm", oldEntry);

    const candidates = await findTransitionCandidates(tmpDir, "warm");
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe("mem-warm-old");
  });
});

describe("collectMemoryHealth", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `memory-health-${Date.now()}`);
    await mkdir(join(tmpDir, "workspace", "memory", "hot"), { recursive: true });
    await mkdir(join(tmpDir, "workspace", "memory", "warm"), { recursive: true });
    await mkdir(join(tmpDir, "workspace", "memory", "cold"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns zero counts for empty memory", async () => {
    const health = await collectMemoryHealth(tmpDir);
    expect(health.totalEntries).toBe(0);
    expect(health.totalSizeBytes).toBe(0);
    expect(health.hotTierOverBudget).toBe(false);
  });

  it("counts entries across tiers", async () => {
    await writeEntry(tmpDir, "hot", makeEntry({ id: "mem-h1" }));
    await writeEntry(tmpDir, "hot", makeEntry({ id: "mem-h2" }));
    await writeEntry(tmpDir, "warm", makeEntry({ id: "mem-w1" }));

    const health = await collectMemoryHealth(tmpDir);
    expect(health.totalEntries).toBe(3);
    expect(health.tiers.find((t) => t.name === "hot")?.entryCount).toBe(2);
    expect(health.tiers.find((t) => t.name === "warm")?.entryCount).toBe(1);
  });

  it("detects stale entries", async () => {
    const staleEntry = makeEntry({
      id: "mem-stale",
      lastAccessedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await writeEntry(tmpDir, "hot", staleEntry);

    const health = await collectMemoryHealth(tmpDir);
    expect(health.staleEntriesCount).toBe(1);
  });
});

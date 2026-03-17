import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { searchMemory } from "./search.js";
import { writeEntry } from "./store.js";
import type { ContextEntry, PreferenceEntry, RelationshipEntry } from "./types.js";

function makePref(overrides: Partial<PreferenceEntry> = {}): PreferenceEntry {
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

describe("searchMemory", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `memory-search-${Date.now()}`);
    await mkdir(join(tmpDir, "workspace", "memory", "hot"), { recursive: true });
    await mkdir(join(tmpDir, "workspace", "memory", "warm"), { recursive: true });
    await mkdir(join(tmpDir, "workspace", "memory", "cold"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty results for empty tiers", async () => {
    const results = await searchMemory(tmpDir, "meeting");
    expect(results).toEqual([]);
  });

  it("finds entries matching keyword in content", async () => {
    await writeEntry(tmpDir, "warm", makePref({
      id: "mem-1",
      content: "User prefers meeting notes in bullet points",
    }));
    await writeEntry(tmpDir, "warm", makePref({
      id: "mem-2",
      content: "User likes coffee in the morning",
    }));

    const results = await searchMemory(tmpDir, "meeting");
    expect(results).toHaveLength(1);
    expect(results[0].entry.id).toBe("mem-1");
    expect(results[0].tier).toBe("warm");
  });

  it("is case-insensitive", async () => {
    await writeEntry(tmpDir, "cold", makePref({
      id: "mem-1",
      content: "User attended a MEETING with the board",
    }));

    const results = await searchMemory(tmpDir, "meeting");
    expect(results).toHaveLength(1);
    expect(results[0].entry.id).toBe("mem-1");
  });

  it("searches across warm and cold tiers by default", async () => {
    await writeEntry(tmpDir, "warm", makePref({
      id: "mem-warm",
      content: "weekly meeting with team",
    }));
    await writeEntry(tmpDir, "cold", makePref({
      id: "mem-cold",
      content: "annual meeting review",
    }));
    // hot should NOT be included by default
    await writeEntry(tmpDir, "hot", makePref({
      id: "mem-hot",
      content: "meeting scheduled for tomorrow",
    }));

    const results = await searchMemory(tmpDir, "meeting");
    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.entry.id);
    expect(ids).toContain("mem-warm");
    expect(ids).toContain("mem-cold");
    expect(ids).not.toContain("mem-hot");
  });

  it("includes hot tier when explicitly requested", async () => {
    await writeEntry(tmpDir, "hot", makePref({
      id: "mem-hot",
      content: "meeting scheduled for tomorrow",
    }));

    const results = await searchMemory(tmpDir, "meeting", {
      tiers: ["hot", "warm", "cold"],
    });
    expect(results).toHaveLength(1);
    expect(results[0].entry.id).toBe("mem-hot");
  });

  it("restricts to a single tier with tiers option", async () => {
    await writeEntry(tmpDir, "warm", makePref({
      id: "mem-warm",
      content: "meeting prep notes",
    }));
    await writeEntry(tmpDir, "cold", makePref({
      id: "mem-cold",
      content: "meeting summary archive",
    }));

    const results = await searchMemory(tmpDir, "meeting", { tiers: ["cold"] });
    expect(results).toHaveLength(1);
    expect(results[0].entry.id).toBe("mem-cold");
  });

  it("filters by --since date", async () => {
    await writeEntry(tmpDir, "warm", makePref({
      id: "mem-old",
      content: "old meeting from last year",
      createdAt: "2025-01-01T00:00:00.000Z",
    }));
    await writeEntry(tmpDir, "warm", makePref({
      id: "mem-new",
      content: "recent meeting notes",
      createdAt: "2026-03-01T00:00:00.000Z",
    }));

    const results = await searchMemory(tmpDir, "meeting", {
      since: "2026-01-01",
    });
    expect(results).toHaveLength(1);
    expect(results[0].entry.id).toBe("mem-new");
  });

  it("ranks exact phrase match higher than word match", async () => {
    await writeEntry(tmpDir, "warm", makePref({
      id: "mem-exact",
      content: "team meeting notes from standup",
    }));
    await writeEntry(tmpDir, "warm", makePref({
      id: "mem-word-only",
      content: "the team had a standup",
      tags: ["meeting"],
    }));

    const results = await searchMemory(tmpDir, "team meeting");
    expect(results.length).toBeGreaterThanOrEqual(2);
    // mem-exact has phrase match in content (+10) + word matches
    // mem-word-only has word match in content (team) + tag match (meeting)
    expect(results[0].entry.id).toBe("mem-exact");
  });

  it("matches on tags", async () => {
    await writeEntry(tmpDir, "warm", makePref({
      id: "mem-tagged",
      content: "Some notes about the event",
      tags: ["meeting", "standup"],
    }));

    const results = await searchMemory(tmpDir, "meeting");
    expect(results).toHaveLength(1);
    expect(results[0].entry.id).toBe("mem-tagged");
  });

  it("shows friendly empty result for no matches", async () => {
    await writeEntry(tmpDir, "warm", makePref({
      id: "mem-1",
      content: "nothing relevant here",
    }));

    const results = await searchMemory(tmpDir, "xyznonexistent");
    expect(results).toEqual([]);
  });

  it("returns empty for blank query", async () => {
    await writeEntry(tmpDir, "warm", makePref({
      id: "mem-1",
      content: "some content",
    }));

    const results = await searchMemory(tmpDir, "  ");
    expect(results).toEqual([]);
  });
});

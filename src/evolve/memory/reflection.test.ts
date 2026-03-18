import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { reflect } from "./reflection.js";
import { writeEntry } from "./store.js";
import type { DomainExpertiseEntry, PreferenceEntry, RelationshipEntry } from "./types.js";

describe("reflect", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `memory-reflect-${Date.now()}`);
    await mkdir(join(tmpDir, "workspace", "memory", "hot"), { recursive: true });
    await mkdir(join(tmpDir, "workspace", "memory", "warm"), { recursive: true });
    await mkdir(join(tmpDir, "workspace", "memory", "cold"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty result for no entries", async () => {
    const result = await reflect(tmpDir);
    expect(result.analyzedCount).toBe(0);
    expect(result.connections).toHaveLength(0);
  });

  it("finds connections between entries with shared tags", async () => {
    const entry1: PreferenceEntry = {
      id: "mem-r1",
      category: "preferences",
      content: "prefers email summaries",
      tags: ["email", "summary", "communication"],
      confidence: "medium",
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      sourceRef: "session-1",
      parentId: null,
    };

    const entry2: DomainExpertiseEntry = {
      id: "mem-r2",
      category: "domain_expertise",
      content: "experienced with email automation",
      tags: ["email", "automation", "communication"],
      confidence: "medium",
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      sourceRef: "session-2",
      domain: "email",
    };

    await writeEntry(tmpDir, "hot", entry1);
    await writeEntry(tmpDir, "hot", entry2);

    const result = await reflect(tmpDir);
    expect(result.analyzedCount).toBe(2);
    expect(result.connections.length).toBeGreaterThan(0);
    expect(result.connections[0].entryIds).toContain("mem-r1");
    expect(result.connections[0].entryIds).toContain("mem-r2");
  });

  it("finds connections between relationship entries with shared entities", async () => {
    const entry1: RelationshipEntry = {
      id: "mem-rel1",
      category: "relationships",
      content: "John works on backend",
      tags: ["john", "backend"],
      confidence: "medium",
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      sourceRef: "session-1",
      entities: ["John", "backend"],
      relationshipType: "works-on",
    };

    const entry2: RelationshipEntry = {
      id: "mem-rel2",
      category: "relationships",
      content: "John manages the API team",
      tags: ["john", "api"],
      confidence: "medium",
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      sourceRef: "session-2",
      entities: ["John", "API team"],
      relationshipType: "manages",
    };

    await writeEntry(tmpDir, "hot", entry1);
    await writeEntry(tmpDir, "warm", entry2);

    const result = await reflect(tmpDir);
    expect(result.connections.length).toBeGreaterThan(0);
  });

  it("skips entries from the same source", async () => {
    const entry1: PreferenceEntry = {
      id: "mem-same1",
      category: "preferences",
      content: "likes coffee",
      tags: ["coffee", "drinks"],
      confidence: "medium",
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      sourceRef: "same-session",
      parentId: null,
    };

    const entry2: PreferenceEntry = {
      id: "mem-same2",
      category: "preferences",
      content: "prefers coffee over tea",
      tags: ["coffee", "drinks"],
      confidence: "medium",
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      sourceRef: "same-session",
      parentId: null,
    };

    await writeEntry(tmpDir, "hot", entry1);
    await writeEntry(tmpDir, "hot", entry2);

    const result = await reflect(tmpDir);
    expect(result.connections).toHaveLength(0);
  });
});

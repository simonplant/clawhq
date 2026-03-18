import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeEntry } from "../../../evolve/memory/store.js";
import type { PreferenceEntry } from "../../../evolve/memory/types.js";
import type { DoctorContext } from "../types.js";

import { memoryHealthCheck } from "./memory-health.js";

function makeCtx(dir: string): DoctorContext {
  return {
    openclawHome: dir,
    configPath: join(dir, "openclaw.json"),
  };
}

function makeEntry(overrides: Partial<PreferenceEntry> = {}): PreferenceEntry {
  return {
    id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    category: "preferences",
    content: "test content",
    tags: ["test"],
    confidence: "medium",
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    sourceRef: "session-1",
    parentId: null,
    ...overrides,
  };
}

describe("memoryHealthCheck", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `doctor-memory-${Date.now()}`);
    await mkdir(join(tmpDir, "workspace", "memory", "hot"), { recursive: true });
    await mkdir(join(tmpDir, "workspace", "memory", "warm"), { recursive: true });
    await mkdir(join(tmpDir, "workspace", "memory", "cold"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("passes when no memory entries exist", async () => {
    const result = await memoryHealthCheck.run(makeCtx(tmpDir));
    expect(result.status).toBe("pass");
    expect(result.message).toContain("No structured memory");
  });

  it("passes for healthy memory", async () => {
    await writeEntry(tmpDir, "hot", makeEntry({ id: "mem-healthy" }));

    const result = await memoryHealthCheck.run(makeCtx(tmpDir));
    expect(result.status).toBe("pass");
    expect(result.message).toContain("Memory healthy");
  });

  it("warns when entries are stale", async () => {
    const staleEntry = makeEntry({
      id: "mem-stale-doc",
      lastAccessedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await writeEntry(tmpDir, "hot", staleEntry);

    const result = await memoryHealthCheck.run(makeCtx(tmpDir));
    expect(result.status).toBe("warn");
    expect(result.message).toContain("stale");
  });

  it("warns when entries are pending transition", async () => {
    const oldEntry = makeEntry({
      id: "mem-pending",
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await writeEntry(tmpDir, "hot", oldEntry);

    const result = await memoryHealthCheck.run(makeCtx(tmpDir));
    expect(result.status).toBe("warn");
    expect(result.message).toContain("pending tier transition");
  });
});

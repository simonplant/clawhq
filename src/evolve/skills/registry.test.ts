import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addSkill,
  findSkill,
  loadRegistry,
  removeSkill,
  saveRegistry,
  updateSkill,
} from "./registry.js";
import type { InstalledSkill, SkillContext, SkillRegistry } from "./types.js";

function makeSkill(overrides: Partial<InstalledSkill> = {}): InstalledSkill {
  return {
    name: "test-skill",
    version: "1.0.0",
    source: "local",
    sourceUri: "/path/to/skill",
    status: "active",
    installedAt: "2026-03-13T00:00:00Z",
    lastUsed: null,
    requiresContainerDeps: false,
    rollbackSnapshotId: null,
    ...overrides,
  };
}

describe("registry", () => {
  let tmpDir: string;
  let ctx: SkillContext;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-registry-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    ctx = {
      openclawHome: join(tmpDir, "openclaw"),
      clawhqDir: tmpDir,
    };
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty registry when file does not exist", async () => {
    const reg = await loadRegistry(ctx);
    expect(reg.skills).toEqual([]);
  });

  it("saves and loads registry", async () => {
    const skill = makeSkill();
    const reg: SkillRegistry = { skills: [skill] };

    await saveRegistry(ctx, reg);
    const loaded = await loadRegistry(ctx);

    expect(loaded.skills).toHaveLength(1);
    expect(loaded.skills[0].name).toBe("test-skill");
  });

  it("persists as valid JSON", async () => {
    await saveRegistry(ctx, { skills: [makeSkill()] });

    const raw = await readFile(join(tmpDir, "skills", "registry.json"), "utf-8");
    const parsed = JSON.parse(raw) as SkillRegistry;
    expect(parsed.skills).toHaveLength(1);
  });
});

describe("registry operations", () => {
  const base: SkillRegistry = {
    skills: [makeSkill({ name: "alpha" }), makeSkill({ name: "beta" })],
  };

  it("findSkill returns matching skill", () => {
    expect(findSkill(base, "alpha")?.name).toBe("alpha");
    expect(findSkill(base, "beta")?.name).toBe("beta");
    expect(findSkill(base, "gamma")).toBeUndefined();
  });

  it("addSkill appends a new skill", () => {
    const updated = addSkill(base, makeSkill({ name: "gamma" }));
    expect(updated.skills).toHaveLength(3);
    expect(findSkill(updated, "gamma")).toBeDefined();
  });

  it("removeSkill filters out the named skill", () => {
    const updated = removeSkill(base, "alpha");
    expect(updated.skills).toHaveLength(1);
    expect(findSkill(updated, "alpha")).toBeUndefined();
    expect(findSkill(updated, "beta")).toBeDefined();
  });

  it("updateSkill merges updates", () => {
    const updated = updateSkill(base, "alpha", { version: "2.0.0", status: "disabled" });
    const skill = findSkill(updated, "alpha");
    expect(skill).toBeDefined();
    expect(skill?.version).toBe("2.0.0");
    expect(skill?.status).toBe("disabled");
    // Other fields unchanged
    expect(skill?.source).toBe("local");
  });

  it("updateSkill leaves other skills unchanged", () => {
    const updated = updateSkill(base, "alpha", { version: "2.0.0" });
    expect(findSkill(updated, "beta")?.version).toBe("1.0.0");
  });
});

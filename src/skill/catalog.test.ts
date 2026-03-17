import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { formatCatalogInfo, formatCatalogSearch } from "./catalog-format.js";
import { BUILTIN_SKILLS, findCatalogSkill, searchCatalog } from "./catalog.js";
import { activateSkill, stageSkillInstall } from "./lifecycle.js";
import { loadRegistry } from "./registry.js";
import type { SkillContext } from "./types.js";
import { SkillError } from "./types.js";

describe("BUILTIN_SKILLS catalog", () => {
  it("contains at least 10 skills", () => {
    expect(BUILTIN_SKILLS.length).toBeGreaterThanOrEqual(10);
  });

  it("every skill has required fields", () => {
    for (const skill of BUILTIN_SKILLS) {
      expect(skill.id).toBeTruthy();
      expect(skill.name).toBeTruthy();
      expect(skill.version).toBeTruthy();
      expect(skill.description).toBeTruthy();
      expect(skill.tags.length).toBeGreaterThan(0);
      expect(skill.files["SKILL.md"]).toBeTruthy();
    }
  });

  it("has unique IDs", () => {
    const ids = BUILTIN_SKILLS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every SKILL.md contains valid frontmatter with name", () => {
    for (const skill of BUILTIN_SKILLS) {
      const skillMd = skill.files["SKILL.md"];
      expect(skillMd).toMatch(/^---\n/);
      expect(skillMd).toMatch(/name:\s/);
    }
  });
});

describe("searchCatalog", () => {
  it("finds morning-brief by 'email'", () => {
    const results = searchCatalog("email");
    const ids = results.map((s) => s.id);
    expect(ids).toContain("morning-brief");
    expect(ids).toContain("email-digest");
  });

  it("finds skills by tag", () => {
    const results = searchCatalog("fitness");
    expect(results.map((s) => s.id)).toContain("workout-planning");
  });

  it("is case-insensitive", () => {
    const results = searchCatalog("MEAL");
    expect(results.map((s) => s.id)).toContain("meal-planning");
  });

  it("returns empty for unknown query", () => {
    expect(searchCatalog("xyznonexistent123")).toEqual([]);
  });

  it("matches on description text", () => {
    const results = searchCatalog("grocery");
    expect(results.map((s) => s.id)).toContain("meal-planning");
  });
});

describe("findCatalogSkill", () => {
  it("returns skill by exact id", () => {
    const skill = findCatalogSkill("morning-brief");
    expect(skill).toBeDefined();
    expect(skill?.name).toBe("Morning Brief");
  });

  it("returns undefined for unknown id", () => {
    expect(findCatalogSkill("nonexistent")).toBeUndefined();
  });
});

describe("formatCatalogSearch", () => {
  it("formats results with count", () => {
    const results = searchCatalog("email");
    const output = formatCatalogSearch(results, "email");
    expect(output).toContain("email");
    expect(output).toContain("morning-brief");
    expect(output).toContain("clawhq skill info");
  });

  it("shows no-results message", () => {
    const output = formatCatalogSearch([], "foobar");
    expect(output).toContain('No skills found matching "foobar"');
  });
});

describe("formatCatalogInfo", () => {
  it("formats skill details", () => {
    const skill = findCatalogSkill("morning-brief");
    if (!skill) throw new Error("morning-brief not found in catalog");
    const output = formatCatalogInfo(skill);
    expect(output).toContain("Morning Brief");
    expect(output).toContain("todoist");
    expect(output).toContain("ical");
    expect(output).toContain("0 7 * * *");
    expect(output).toContain("clawhq skill install morning-brief");
  });

  it("shows standalone for skills with no integrations", () => {
    const skill = findCatalogSkill("meal-planning");
    if (!skill) throw new Error("meal-planning not found in catalog");
    const output = formatCatalogInfo(skill);
    expect(output).toContain("none (standalone)");
  });
});

describe("registry-based install via catalog", () => {
  let tmpDir: string;
  let ctx: SkillContext;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-catalog-${Date.now()}`);
    ctx = {
      openclawHome: join(tmpDir, "openclaw"),
      clawhqDir: join(tmpDir, "clawhq"),
    };
    await mkdir(join(ctx.openclawHome, "workspace", "skills"), { recursive: true });
    await mkdir(join(ctx.clawhqDir, "skills"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("stages a registry skill from the catalog", async () => {
    const { manifest, vetResult, stagingDir } = await stageSkillInstall(ctx, "morning-brief");

    expect(manifest.name).toBe("morning-brief");
    expect(manifest.version).toBe("1.0.0");
    expect(vetResult.passed).toBe(true);
    expect(stagingDir).toContain("staging");
  });

  it("activates a registry skill into workspace", async () => {
    const { manifest, stagingDir } = await stageSkillInstall(ctx, "morning-brief");
    const result = await activateSkill(ctx, manifest, stagingDir, "registry", "morning-brief");

    expect(result.skill.name).toBe("morning-brief");
    expect(result.skill.source).toBe("registry");
    expect(result.skill.status).toBe("active");

    // Verify registry persisted
    const registry = await loadRegistry(ctx);
    expect(registry.skills).toHaveLength(1);
    expect(registry.skills[0].name).toBe("morning-brief");

    // Verify SKILL.md exists in workspace
    const skillMd = await readFile(
      join(ctx.openclawHome, "workspace", "skills", "morning-brief", "SKILL.md"),
      "utf-8",
    );
    expect(skillMd).toContain("morning-brief");
  });

  it("throws for unknown registry skill", async () => {
    await expect(stageSkillInstall(ctx, "nonexistent-skill")).rejects.toThrow(
      SkillError,
    );
  });

  it("installs skill with subdirectory files", async () => {
    // expense-tracking has scripts/expense-store.py
    const { manifest, stagingDir } = await stageSkillInstall(ctx, "expense-tracking");
    const result = await activateSkill(ctx, manifest, stagingDir, "registry", "expense-tracking");

    expect(result.skill.name).toBe("expense-tracking");

    // Verify subdirectory file exists
    const script = await readFile(
      join(ctx.openclawHome, "workspace", "skills", "expense-tracking", "scripts", "expense-store.py"),
      "utf-8",
    );
    expect(script).toContain("expense-store");
  });
});

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  activateSkill,
  applySkillUpdate,
  removeSkillOp,
  resolveSource,
  stageSkillInstall,
  stageSkillUpdate,
} from "./lifecycle.js";
import { loadRegistry, saveRegistry } from "./registry.js";
import type { InstalledSkill, SkillContext } from "./types.js";
import { SkillError } from "./types.js";

function makeCtx(tmpDir: string): SkillContext {
  return {
    openclawHome: join(tmpDir, "openclaw"),
    clawhqDir: join(tmpDir, "clawhq"),
  };
}

async function createTestSkillDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    '---\nname: test-skill\nversion: "2.0.0"\ndescription: "A test skill"\n---\n\n# Test Skill\n\nDoes testing things.\n',
  );
  await mkdir(join(dir, "scripts"), { recursive: true });
  await writeFile(join(dir, "scripts", "run.sh"), "#!/usr/bin/env bash\necho hello\n");
}

function makeSkill(name: string, overrides: Partial<InstalledSkill> = {}): InstalledSkill {
  return {
    name,
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

describe("resolveSource", () => {
  it("detects URL sources", () => {
    expect(resolveSource("https://example.com/skill.tar.gz")).toEqual({
      source: "url",
      uri: "https://example.com/skill.tar.gz",
    });
  });

  it("detects local absolute paths", () => {
    expect(resolveSource("/home/user/my-skill")).toEqual({
      source: "local",
      uri: "/home/user/my-skill",
    });
  });

  it("detects local relative paths", () => {
    expect(resolveSource("./my-skill")).toEqual({
      source: "local",
      uri: "./my-skill",
    });
  });

  it("defaults to registry", () => {
    expect(resolveSource("morning-brief")).toEqual({
      source: "registry",
      uri: "morning-brief",
    });
  });
});

describe("stageSkillInstall", () => {
  let tmpDir: string;
  let ctx: SkillContext;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-lifecycle-${Date.now()}`);
    ctx = makeCtx(tmpDir);
    await mkdir(join(ctx.openclawHome, "workspace", "skills"), { recursive: true });
    await mkdir(join(ctx.openclawHome, "workspace"), { recursive: true });
    await mkdir(join(ctx.clawhqDir, "skills"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("stages a local skill for installation", async () => {
    const skillSrc = join(tmpDir, "source-skill");
    await createTestSkillDir(skillSrc);

    const { manifest, vetResult, stagingDir } = await stageSkillInstall(ctx, skillSrc);

    expect(manifest.name).toBe("test-skill");
    expect(manifest.version).toBe("2.0.0");
    expect(vetResult.passed).toBe(true);
    expect(stagingDir).toContain("staging");
  });

  it("rejects duplicate skill names", async () => {
    const skillSrc = join(tmpDir, "source-skill");
    await createTestSkillDir(skillSrc);

    // Pre-install a skill with the same name
    await saveRegistry(ctx, { skills: [makeSkill("test-skill")] });

    await expect(stageSkillInstall(ctx, skillSrc)).rejects.toThrow(SkillError);
  });

  it("rejects non-existent source directory", async () => {
    await expect(
      stageSkillInstall(ctx, "/nonexistent/path"),
    ).rejects.toThrow(SkillError);
  });

  it("rejects skill without SKILL.md", async () => {
    const skillSrc = join(tmpDir, "no-skillmd");
    await mkdir(skillSrc, { recursive: true });
    await writeFile(join(skillSrc, "README.md"), "# Not a skill\n");

    await expect(stageSkillInstall(ctx, skillSrc)).rejects.toThrow("SKILL.md");
  });
});

describe("activateSkill", () => {
  let tmpDir: string;
  let ctx: SkillContext;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-activate-${Date.now()}`);
    ctx = makeCtx(tmpDir);
    await mkdir(join(ctx.openclawHome, "workspace", "skills"), { recursive: true });
    await mkdir(join(ctx.clawhqDir, "skills"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("moves staged skill to workspace and updates registry", async () => {
    const skillSrc = join(tmpDir, "source-skill");
    await createTestSkillDir(skillSrc);

    const { manifest, stagingDir } = await stageSkillInstall(ctx, skillSrc);
    const result = await activateSkill(ctx, manifest, stagingDir, "local", skillSrc);

    expect(result.skill.name).toBe("test-skill");
    expect(result.skill.status).toBe("active");

    // Verify in registry
    const registry = await loadRegistry(ctx);
    expect(registry.skills).toHaveLength(1);
    expect(registry.skills[0].name).toBe("test-skill");

    // Verify files exist in workspace
    const skillMd = await readFile(
      join(ctx.openclawHome, "workspace", "skills", "test-skill", "SKILL.md"),
      "utf-8",
    );
    expect(skillMd).toContain("test-skill");
  });

  it("updates TOOLS.md with new skill", async () => {
    // Create a TOOLS.md to update
    await writeFile(
      join(ctx.openclawHome, "workspace", "TOOLS.md"),
      "# TOOLS.md — Agent Toolbelt\n\n## Core Tools\n\n",
    );

    const skillSrc = join(tmpDir, "source-skill");
    await createTestSkillDir(skillSrc);

    const { manifest, stagingDir } = await stageSkillInstall(ctx, skillSrc);
    await activateSkill(ctx, manifest, stagingDir, "local", skillSrc);

    const toolsMd = await readFile(
      join(ctx.openclawHome, "workspace", "TOOLS.md"),
      "utf-8",
    );
    expect(toolsMd).toContain("test-skill");
    expect(toolsMd).toContain("## Skills");
  });
});

describe("removeSkillOp", () => {
  let tmpDir: string;
  let ctx: SkillContext;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-remove-${Date.now()}`);
    ctx = makeCtx(tmpDir);
    await mkdir(join(ctx.openclawHome, "workspace", "skills", "my-skill"), { recursive: true });
    await mkdir(join(ctx.clawhqDir, "skills"), { recursive: true });
    // Write some skill files
    await writeFile(
      join(ctx.openclawHome, "workspace", "skills", "my-skill", "SKILL.md"),
      "---\nname: my-skill\n---\n",
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("removes skill and creates rollback snapshot", async () => {
    await saveRegistry(ctx, { skills: [makeSkill("my-skill")] });

    const result = await removeSkillOp(ctx, "my-skill");

    expect(result.snapshotId).toMatch(/^snap-my-skill-/);

    // Registry updated
    const registry = await loadRegistry(ctx);
    expect(registry.skills).toHaveLength(0);
  });

  it("throws for non-existent skill", async () => {
    await saveRegistry(ctx, { skills: [] });

    await expect(removeSkillOp(ctx, "ghost")).rejects.toThrow(SkillError);
  });
});

describe("stageSkillUpdate + applySkillUpdate", () => {
  let tmpDir: string;
  let ctx: SkillContext;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-update-${Date.now()}`);
    ctx = makeCtx(tmpDir);
    await mkdir(join(ctx.openclawHome, "workspace", "skills", "test-skill"), { recursive: true });
    await mkdir(join(ctx.clawhqDir, "skills"), { recursive: true });
    // Existing installed skill
    await writeFile(
      join(ctx.openclawHome, "workspace", "skills", "test-skill", "SKILL.md"),
      '---\nname: test-skill\nversion: "1.0.0"\n---\n# Old version\n',
    );
    await saveRegistry(ctx, { skills: [makeSkill("test-skill")] });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("stages update from new source", async () => {
    const newSrc = join(tmpDir, "new-version");
    await createTestSkillDir(newSrc);

    const { manifest, vetResult } = await stageSkillUpdate(ctx, "test-skill", newSrc);

    expect(manifest.version).toBe("2.0.0");
    expect(vetResult.passed).toBe(true);
  });

  it("applies update and creates snapshot of old version", async () => {
    const newSrc = join(tmpDir, "new-version");
    await createTestSkillDir(newSrc);

    const { manifest, stagingDir } = await stageSkillUpdate(ctx, "test-skill", newSrc);
    const result = await applySkillUpdate(ctx, "test-skill", manifest, stagingDir);

    expect(result.previousVersion).toBe("1.0.0");
    expect(result.skill.version).toBe("2.0.0");
    expect(result.snapshotId).toMatch(/^snap-test-skill-/);

    // Registry updated
    const registry = await loadRegistry(ctx);
    expect(registry.skills[0].version).toBe("2.0.0");
  });

  it("throws when updating non-existent skill", async () => {
    await saveRegistry(ctx, { skills: [] });

    await expect(
      stageSkillUpdate(ctx, "ghost", "/nonexistent"),
    ).rejects.toThrow(SkillError);
  });
});

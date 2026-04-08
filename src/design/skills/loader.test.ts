import { describe, expect, it } from "vitest";

import {
  listConfigSkillNames,
  listPlatformSkillNames,
  listProfileSkillNames,
  loadBlueprintSkills,
  loadPlatformSkills,
} from "./loader.js";

// ── Platform Skills ─────────────────────────────────────────────────────────

describe("loadPlatformSkills", () => {
  it("returns entries for cron-doctor and scanner-triage", () => {
    const skills = loadPlatformSkills();
    const skillNames = [...new Set(skills.map((s) => s.skillName))];
    expect(skillNames).toContain("cron-doctor");
    expect(skillNames).toContain("scanner-triage");
  });

  it("includes SKILL.md for each platform skill", () => {
    const skills = loadPlatformSkills();
    const cronDoctor = skills.filter((s) => s.skillName === "cron-doctor");
    expect(cronDoctor.some((f) => f.relativePath.endsWith("SKILL.md"))).toBe(true);

    const scannerTriage = skills.filter((s) => s.skillName === "scanner-triage");
    expect(scannerTriage.some((f) => f.relativePath.endsWith("SKILL.md"))).toBe(true);
  });

  it("sets relativePath under workspace/skills/", () => {
    const skills = loadPlatformSkills();
    for (const skill of skills) {
      expect(skill.relativePath).toMatch(/^workspace\/skills\//);
    }
  });

  it("returns non-empty content for each file", () => {
    const skills = loadPlatformSkills();
    expect(skills.length).toBeGreaterThan(0);
    for (const skill of skills) {
      expect(skill.content.length).toBeGreaterThan(0);
    }
  });
});

describe("listPlatformSkillNames", () => {
  it("includes cron-doctor and scanner-triage", () => {
    const names = listPlatformSkillNames();
    expect(names).toContain("cron-doctor");
    expect(names).toContain("scanner-triage");
  });
});

// ── Profile Skills ─────────────────────────────────────────────────────────

const PROFILE_SKILL_NAMES = [
  "content-seed",
  "eod-review",
  "meal-planner",
  "trade-journal",
  "trip-planner",
] as const;

describe("listProfileSkillNames", () => {
  it("includes all 5 profile skills", () => {
    const names = listProfileSkillNames();
    for (const name of PROFILE_SKILL_NAMES) {
      expect(names).toContain(name);
    }
  });
});

describe("loadBlueprintSkills — profile skills", () => {
  it("loads profile skills by name via loadBlueprintSkills", () => {
    for (const name of PROFILE_SKILL_NAMES) {
      const skills = loadBlueprintSkills([name]);
      expect(skills.length, `${name}: should return at least one file`).toBeGreaterThan(0);

      const names = [...new Set(skills.map((s) => s.skillName))];
      expect(names).toEqual([name]);
    }
  });

  it("includes SKILL.md for each profile skill", () => {
    const skills = loadBlueprintSkills([...PROFILE_SKILL_NAMES]);
    for (const name of PROFILE_SKILL_NAMES) {
      const skillFiles = skills.filter((s) => s.skillName === name);
      expect(
        skillFiles.some((f) => f.relativePath.endsWith("SKILL.md")),
        `${name}: should include SKILL.md`,
      ).toBe(true);
    }
  });

  it("sets relativePath under workspace/skills/ for profile skills", () => {
    const skills = loadBlueprintSkills([...PROFILE_SKILL_NAMES]);
    for (const skill of skills) {
      expect(skill.relativePath).toMatch(/^workspace\/skills\//);
    }
  });

  it("returns non-empty SKILL.md content with behavioral guidance", () => {
    const skills = loadBlueprintSkills([...PROFILE_SKILL_NAMES]);
    for (const name of PROFILE_SKILL_NAMES) {
      const skillMd = skills.find(
        (s) => s.skillName === name && s.relativePath.endsWith("SKILL.md"),
      );
      expect(skillMd, `${name}: SKILL.md should exist`).toBeDefined();
      expect(skillMd!.content).toContain("## Behavior");
      expect(skillMd!.content).toContain("## Boundaries");
    }
  });

  it("loads all 5 profile skills together", () => {
    const skills = loadBlueprintSkills([...PROFILE_SKILL_NAMES]);
    const loaded = [...new Set(skills.map((s) => s.skillName))];
    expect(loaded).toHaveLength(5);
    for (const name of PROFILE_SKILL_NAMES) {
      expect(loaded).toContain(name);
    }
  });
});

// ── Blueprint Skills ────────────────────────────────────────────────────────

describe("loadBlueprintSkills", () => {
  it("loads skills from configs/skills/ by name", () => {
    const skills = loadBlueprintSkills(["schedule-guard"]);
    expect(skills.length).toBeGreaterThan(0);

    const names = [...new Set(skills.map((s) => s.skillName))];
    expect(names).toEqual(["schedule-guard"]);
  });

  it("includes SKILL.md and prompt files for multi-file skills", () => {
    const skills = loadBlueprintSkills(["schedule-guard"]);
    expect(skills.some((f) => f.relativePath.endsWith("SKILL.md"))).toBe(true);
    expect(skills.some((f) => f.relativePath.includes("prompts/"))).toBe(true);
  });

  it("loads config.yaml from skills", () => {
    const skills = loadBlueprintSkills(["schedule-guard"]);
    expect(skills.some((f) => f.relativePath.endsWith("config.yaml"))).toBe(true);
  });

  it("silently skips non-existent skill names", () => {
    const skills = loadBlueprintSkills(["nonexistent-skill"]);
    expect(skills).toHaveLength(0);
  });

  it("loads multiple skills when given multiple names", () => {
    const skills = loadBlueprintSkills(["email-digest", "morning-brief"]);
    const names = [...new Set(skills.map((s) => s.skillName))];
    expect(names).toContain("email-digest");
    expect(names).toContain("morning-brief");
  });

  it("returns empty array for empty input", () => {
    const skills = loadBlueprintSkills([]);
    expect(skills).toHaveLength(0);
  });
});

describe("listConfigSkillNames", () => {
  it("includes known config skills", () => {
    const names = listConfigSkillNames();
    expect(names).toContain("schedule-guard");
    expect(names).toContain("email-digest");
    expect(names).toContain("construct");
  });
});

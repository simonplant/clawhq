import { describe, expect, it } from "vitest";

import { generateConstructSkill, generateStatePy } from "./construct.js";

describe("generateConstructSkill", () => {
  it("includes scripts/state.py in output", () => {
    const skill = generateConstructSkill();
    expect(skill).toHaveProperty("scripts/state.py");
  });

  it("includes all expected files", () => {
    const skill = generateConstructSkill();
    expect(Object.keys(skill)).toEqual(
      expect.arrayContaining([
        "SKILL.md",
        "SOUL.md",
        "references/skill-spec.md",
        "scripts/state.py",
      ]),
    );
  });
});

describe("generateStatePy", () => {
  const content = generateStatePy();

  const requiredCommands = [
    "assess-save",
    "assess-load",
    "propose-save",
    "propose-load",
    "build-save",
    "build-load",
    "deploy-save",
    "review",
    "config",
  ];

  it.each(requiredCommands)("contains the '%s' command", (cmd) => {
    expect(content).toContain(cmd);
  });

  it("starts with a python3 shebang", () => {
    expect(content).toMatch(/^#!\/usr\/bin\/env python3/);
  });

  it("uses Path.home() instead of hardcoded paths", () => {
    expect(content).toContain("Path.home()");
    expect(content).not.toMatch(/\/home\/[a-z]/);
    expect(content).not.toContain("/root/");
  });

  it("uses argparse for CLI parsing", () => {
    expect(content).toContain("import argparse");
    expect(content).toContain("add_subparsers");
  });

  it("stores state as JSON", () => {
    expect(content).toContain("import json");
    expect(content).toContain("json.loads");
    expect(content).toContain("json.dumps");
  });
});

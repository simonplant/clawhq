import { describe, expect, it } from "vitest";

import { loadBlueprint } from "../blueprints/loader.js";
import type { Blueprint } from "../blueprints/types.js";

import { generateAgents } from "./agents.js";
import { generateSoul } from "./soul.js";

import { generateIdentityFiles } from "./index.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

function loadEmailManager(): Blueprint {
  return loadBlueprint("email-manager").blueprint;
}

function loadFamilyHub(): Blueprint {
  return loadBlueprint("family-hub").blueprint;
}

// ── SOUL.md Tests ───────────────────────────────────────────────────────────

describe("generateSoul", () => {
  it("includes blueprint name as heading", () => {
    const bp = loadEmailManager();
    const content = generateSoul(bp);
    expect(content).toContain("# Email Manager");
  });

  it("includes tagline", () => {
    const bp = loadEmailManager();
    const content = generateSoul(bp);
    expect(content).toContain(bp.use_case_mapping.tagline);
  });

  it("includes personality tone, style, and relationship", () => {
    const bp = loadEmailManager();
    const content = generateSoul(bp);
    expect(content).toContain(`**Tone:** ${bp.personality.tone}`);
    expect(content).toContain(`**Style:** ${bp.personality.style}`);
    expect(content).toContain(`**Relationship:** ${bp.personality.relationship}`);
  });

  it("includes boundaries", () => {
    const bp = loadEmailManager();
    const content = generateSoul(bp);
    expect(content).toContain(bp.personality.boundaries);
  });

  it("includes day in the life narrative", () => {
    const bp = loadEmailManager();
    const content = generateSoul(bp);
    expect(content).toContain("Day in the Life");
    expect(content).toContain(bp.use_case_mapping.day_in_the_life.trim());
  });

  it("includes role description", () => {
    const bp = loadEmailManager();
    const content = generateSoul(bp);
    expect(content).toContain("## Role");
    expect(content).toContain(bp.use_case_mapping.description.trim());
  });
});

// ── AGENTS.md Tests ─────────────────────────────────────────────────────────

describe("generateAgents", () => {
  it("includes agent name as heading", () => {
    const bp = loadEmailManager();
    const content = generateAgents(bp);
    expect(content).toContain("# Agent: Email Manager");
  });

  it("includes what it replaces", () => {
    const bp = loadEmailManager();
    const content = generateAgents(bp);
    expect(content).toContain(`**Replaces:** ${bp.use_case_mapping.replaces}`);
  });

  it("includes toolbelt role", () => {
    const bp = loadEmailManager();
    const content = generateAgents(bp);
    expect(content).toContain(`**Role:** ${bp.toolbelt.role}`);
  });

  it("lists all tools from blueprint", () => {
    const bp = loadEmailManager();
    const content = generateAgents(bp);
    for (const tool of bp.toolbelt.tools) {
      expect(content).toContain(`**${tool.name}**`);
      expect(content).toContain(tool.description);
    }
  });

  it("lists all skills from blueprint", () => {
    const bp = loadEmailManager();
    const content = generateAgents(bp);
    for (const skill of bp.toolbelt.skills) {
      expect(content).toContain(`**${skill.name}**`);
      expect(content).toContain(skill.description);
    }
  });

  it("includes autonomy model", () => {
    const bp = loadEmailManager();
    const content = generateAgents(bp);
    expect(content).toContain(`**Default level:** ${bp.autonomy_model.default}`);
  });

  it("lists approval requirements", () => {
    const bp = loadEmailManager();
    const content = generateAgents(bp);
    for (const item of bp.autonomy_model.requires_approval) {
      expect(content).toContain(`- ${item}`);
    }
  });
});

// ── generateIdentityFiles Tests ─────────────────────────────────────────────

describe("generateIdentityFiles", () => {
  it("returns SOUL.md and AGENTS.md", () => {
    const bp = loadEmailManager();
    const files = generateIdentityFiles(bp);
    const names = files.map((f) => f.name);
    expect(names).toContain("SOUL.md");
    expect(names).toContain("AGENTS.md");
  });

  it("uses correct relative paths", () => {
    const bp = loadEmailManager();
    const files = generateIdentityFiles(bp);
    const paths = files.map((f) => f.relativePath);
    expect(paths).toContain("workspace/identity/SOUL.md");
    expect(paths).toContain("workspace/identity/AGENTS.md");
  });

  it("fits within default token budget (LM-08)", () => {
    const bp = loadEmailManager();
    const files = generateIdentityFiles(bp);
    const totalSize = files.reduce(
      (sum, f) => sum + Buffer.byteLength(f.content, "utf-8"),
      0,
    );
    expect(totalSize).toBeLessThanOrEqual(20_000);
  });

  it("truncates content when exceeding custom token budget", () => {
    const bp = loadEmailManager();
    const fullFiles = generateIdentityFiles(bp);
    const fullSize = fullFiles.reduce(
      (sum, f) => sum + Buffer.byteLength(f.content, "utf-8"),
      0,
    );
    // Use a budget smaller than the full size but large enough for truncation marker
    const budget = Math.floor(fullSize / 2);
    const files = generateIdentityFiles(bp, budget);
    const totalSize = files.reduce(
      (sum, f) => sum + Buffer.byteLength(f.content, "utf-8"),
      0,
    );
    expect(totalSize).toBeLessThanOrEqual(budget);
    expect(totalSize).toBeGreaterThan(0);
  });

  it("works for all built-in blueprints", () => {
    const blueprintNames = [
      "email-manager",
      "family-hub",
      "founders-ops",
      "replace-chatgpt-plus",
      "replace-google-assistant",
      "replace-my-pa",
      "research-copilot",
    ];

    for (const name of blueprintNames) {
      const bp = loadBlueprint(name).blueprint;
      const files = generateIdentityFiles(bp);
      expect(files.length, `${name} should produce identity files`).toBe(2);

      const totalSize = files.reduce(
        (sum, f) => sum + Buffer.byteLength(f.content, "utf-8"),
        0,
      );
      expect(
        totalSize,
        `${name} identity files should fit within token budget`,
      ).toBeLessThanOrEqual(20_000);
    }
  });

  it("SOUL.md contains personality from blueprint", () => {
    const bp = loadFamilyHub();
    const files = generateIdentityFiles(bp);
    const soul = files.find((f) => f.name === "SOUL.md");
    expect(soul).toBeDefined();
    const soulContent = soul?.content ?? "";
    expect(soulContent).toContain(bp.personality.tone);
    expect(soulContent).toContain(bp.personality.boundaries);
  });

  it("AGENTS.md contains tool/skill inventory", () => {
    const bp = loadFamilyHub();
    const files = generateIdentityFiles(bp);
    const agents = files.find((f) => f.name === "AGENTS.md");
    expect(agents).toBeDefined();
    const agentsContent = agents?.content ?? "";
    for (const tool of bp.toolbelt.tools) {
      expect(agentsContent).toContain(tool.name);
    }
    for (const skill of bp.toolbelt.skills) {
      expect(agentsContent).toContain(skill.name);
    }
  });
});

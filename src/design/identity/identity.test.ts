import { describe, expect, it } from "vitest";

import { loadBlueprint } from "../blueprints/loader.js";
import type { Blueprint } from "../blueprints/types.js";
import type { UserContext } from "../configure/types.js";

import { generateAgents } from "./agents.js";
import { generateSoul } from "./soul.js";
import { generateTools } from "./tools.js";
import { generateUser } from "./user.js";

import { generateIdentityFiles } from "./index.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

function loadEmailManager(): Blueprint {
  return loadBlueprint("email-manager").blueprint;
}

function loadFamilyHub(): Blueprint {
  return loadBlueprint("family-hub").blueprint;
}

function loadStockTrading(): Blueprint {
  return loadBlueprint("stock-trading-assistant").blueprint;
}

const TEST_USER_CONTEXT: UserContext = {
  name: "Alice",
  timezone: "America/New_York",
  communicationPreference: "brief",
  constraints: "No messages before 9am",
};

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

  it("includes personality sections when dimensions are present", () => {
    const bp = loadEmailManager();
    const content = generateSoul(bp);
    // With dimensions, personality renders as prose sections
    expect(content).toContain("### Communication Style");
    expect(content).toContain("### Working Style");
    expect(content).toContain("### Cognitive Style");
    expect(content).toContain("## Relationship");
    expect(content).toContain(bp.personality.relationship);
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

// ── USER.md Tests ──────────────────────────────────────────────────────────

describe("generateUser", () => {
  it("includes user name", () => {
    const content = generateUser(TEST_USER_CONTEXT);
    expect(content).toContain("Alice");
  });

  it("includes timezone", () => {
    const content = generateUser(TEST_USER_CONTEXT);
    expect(content).toContain("America/New_York");
  });

  it("includes communication preference description", () => {
    const content = generateUser(TEST_USER_CONTEXT);
    expect(content).toContain("Communication Preference");
    expect(content).toContain("brief");
  });

  it("includes constraints when provided", () => {
    const content = generateUser(TEST_USER_CONTEXT);
    expect(content).toContain("Constraints");
    expect(content).toContain("No messages before 9am");
  });

  it("omits constraints section when not provided", () => {
    const ctx: UserContext = {
      name: "Bob",
      timezone: "UTC",
      communicationPreference: "detailed",
    };
    const content = generateUser(ctx);
    expect(content).not.toContain("## Constraints");
  });
});

// ── TOOLS.md Tests ─────────────────────────────────────────────────────────

describe("generateTools", () => {
  it("includes blueprint name in heading", () => {
    const bp = loadEmailManager();
    const content = generateTools(bp);
    expect(content).toContain("# Tool Reference: Email Manager");
  });

  it("includes toolbelt role", () => {
    const bp = loadEmailManager();
    const content = generateTools(bp);
    expect(content).toContain(bp.toolbelt.role);
  });

  it("groups tools by category", () => {
    const bp = loadEmailManager();
    const content = generateTools(bp);
    // Email Manager has tools in email, calendar, tasks, core categories
    expect(content).toContain("### Email");
    expect(content).toContain("### Calendar");
    expect(content).toContain("### Core");
  });

  it("lists all tools with descriptions", () => {
    const bp = loadEmailManager();
    const content = generateTools(bp);
    for (const tool of bp.toolbelt.tools) {
      expect(content).toContain(`**${tool.name}**`);
      expect(content).toContain(tool.description);
    }
  });

  it("lists all skills", () => {
    const bp = loadEmailManager();
    const content = generateTools(bp);
    for (const skill of bp.toolbelt.skills) {
      expect(content).toContain(`**${skill.name}**`);
      expect(content).toContain(skill.description);
    }
  });

  it("marks required vs optional tools", () => {
    const bp = loadEmailManager();
    const content = generateTools(bp);
    expect(content).toContain("**required**");
    expect(content).toContain("optional");
  });
});

// ── generateIdentityFiles Tests ─────────────────────────────────────────────

describe("generateIdentityFiles", () => {
  it("returns SOUL.md, AGENTS.md, and TOOLS.md", () => {
    const bp = loadEmailManager();
    const files = generateIdentityFiles(bp);
    const names = files.map((f) => f.name);
    expect(names).toContain("SOUL.md");
    expect(names).toContain("AGENTS.md");
    expect(names).toContain("TOOLS.md");
  });

  it("includes USER.md when userContext is provided", () => {
    const bp = loadEmailManager();
    const files = generateIdentityFiles(bp, undefined, {}, undefined, TEST_USER_CONTEXT);
    const names = files.map((f) => f.name);
    expect(names).toContain("USER.md");
    const userFile = files.find((f) => f.name === "USER.md");
    expect(userFile?.content).toContain("Alice");
  });

  it("omits USER.md when no userContext is provided", () => {
    const bp = loadEmailManager();
    const files = generateIdentityFiles(bp);
    const names = files.map((f) => f.name);
    expect(names).not.toContain("USER.md");
  });

  it("includes blueprint-defined runbooks", () => {
    const bp = loadStockTrading();
    expect(bp.runbooks).toBeDefined();
    const files = generateIdentityFiles(bp);
    const names = files.map((f) => f.name);
    expect(names).toContain("RISK-GUARDRAILS.md");
  });

  it("runbook content is included in identity files", () => {
    const bp = loadEmailManager();
    expect(bp.runbooks).toBeDefined();
    const files = generateIdentityFiles(bp);
    const runbook = files.find((f) => f.name === "TRIAGE-RULES.md");
    expect(runbook).toBeDefined();
    expect(runbook?.content).toContain("Priority Classification");
  });

  it("uses correct relative paths for all file types", () => {
    const bp = loadEmailManager();
    const files = generateIdentityFiles(bp, undefined, {}, undefined, TEST_USER_CONTEXT);
    const paths = files.map((f) => f.relativePath);
    expect(paths).toContain("workspace/identity/SOUL.md");
    expect(paths).toContain("workspace/identity/AGENTS.md");
    expect(paths).toContain("workspace/identity/TOOLS.md");
    expect(paths).toContain("workspace/identity/USER.md");
    expect(paths).toContain("workspace/identity/TRIAGE-RULES.md");
  });

  it("fits within default token budget (LM-08)", () => {
    const bp = loadEmailManager();
    const files = generateIdentityFiles(bp, undefined, {}, undefined, TEST_USER_CONTEXT);
    const totalSize = files.reduce(
      (sum, f) => sum + Buffer.byteLength(f.content, "utf-8"),
      0,
    );
    expect(totalSize).toBeLessThanOrEqual(20_000);
  });

  it("truncates content when exceeding custom token budget", () => {
    const bp = loadEmailManager();
    const fullFiles = generateIdentityFiles(bp, undefined, {}, undefined, TEST_USER_CONTEXT);
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
      "stock-trading-assistant",
      "content-creator",
      "personal-finance-assistant",
    ];

    for (const name of blueprintNames) {
      const bp = loadBlueprint(name).blueprint;
      const files = generateIdentityFiles(bp);
      // At minimum: SOUL.md, AGENTS.md, TOOLS.md (+ runbooks if defined)
      expect(files.length, `${name} should produce at least 3 identity files`).toBeGreaterThanOrEqual(3);

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

  it("token budget accounts for all identity files including runbooks and USER.md", () => {
    const bp = loadStockTrading();
    const files = generateIdentityFiles(bp, undefined, {}, undefined, TEST_USER_CONTEXT);
    // Should have SOUL.md, AGENTS.md, TOOLS.md, USER.md, RISK-GUARDRAILS.md
    expect(files.length).toBeGreaterThanOrEqual(5);

    const totalSize = files.reduce(
      (sum, f) => sum + Buffer.byteLength(f.content, "utf-8"),
      0,
    );
    expect(totalSize).toBeLessThanOrEqual(20_000);
  });

  it("SOUL.md contains personality from blueprint", () => {
    const bp = loadFamilyHub();
    const files = generateIdentityFiles(bp);
    const soul = files.find((f) => f.name === "SOUL.md");
    expect(soul).toBeDefined();
    const soulContent = soul?.content ?? "";
    // With dimensions, personality renders as prose sections, not flat strings
    expect(soulContent).toContain("## Personality");
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

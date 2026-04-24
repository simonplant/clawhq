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

  it("renders customization answers into a User Preferences section", () => {
    // customization_questions → SOUL.md is the documented flow for blueprint
    // author-defined questions (communication_style, triage_priority, etc).
    // Each answer shows up under "User Preferences" using the question's
    // prompt as the label. This is the agent-visible surface that turns
    // wizard answers into runtime behaviour — the agent reads SOUL.md and
    // honours the preferences.
    const bp = loadEmailManager();
    const content = generateSoul(bp, {
      communication_style: "Brief and direct — bullet points, no fluff",
      triage_priority: "Emails from my manager or containing 'urgent'",
    });
    expect(content).toContain("## User Preferences");
    expect(content).toContain("**How should your agent communicate?** Brief and direct — bullet points, no fluff");
    expect(content).toContain("**What type of emails should always be flagged as high priority?** Emails from my manager or containing 'urgent'");
  });

  it("skips User Preferences section entirely when no customization answers given", () => {
    const bp = loadEmailManager();
    const content = generateSoul(bp, {});
    expect(content).not.toContain("## User Preferences");
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

  // ── Three-tier approval gates ──────────────────────────────────────────

  it("includes approval gates section with autonomy level", () => {
    const bp = loadEmailManager();
    const content = generateAgents(bp);
    expect(content).toContain("## Approval Gates");
    expect(content).toContain("**Autonomy level:** medium");
  });

  it("renders three delegation tiers with per-action examples", () => {
    const bp = loadEmailManager();
    const content = generateAgents(bp);
    expect(content).toContain("### Execute — Agent acts autonomously");
    expect(content).toContain("### Propose — Agent drafts, user approves");
    expect(content).toContain("### Approve — User must explicitly request");
    // Per-action examples from email-manager delegation
    expect(content).toContain("Archive newsletters and read receipts after triage");
    expect(content).toContain("Draft reply to known contact");
    expect(content).toContain("First email to unknown recipient");
  });

  it("lists hard approval requirements", () => {
    const bp = loadEmailManager();
    const content = generateAgents(bp);
    expect(content).toContain("**Hard gates (always require approval):**");
    for (const item of bp.autonomy_model.requires_approval) {
      expect(content).toContain(item.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
    }
  });

  it("low autonomy maps to conservative delegation defaults", () => {
    const bp = loadStockTrading();
    // Override to low for testing tier mapping
    const lowBp = {
      ...bp,
      autonomy_model: { ...bp.autonomy_model, default: "low" as const },
    };
    const content = generateAgents(lowBp);
    expect(content).toContain("**Autonomy level:** low");
    expect(content).toContain("Conservative");
  });

  it("medium autonomy maps to balanced delegation defaults", () => {
    const bp = loadEmailManager();
    const content = generateAgents(bp);
    expect(content).toContain("**Autonomy level:** medium");
    expect(content).toContain("Balanced");
  });

  it("high autonomy maps to high-autonomy delegation defaults", () => {
    const bp = loadBlueprint("replace-google-assistant").blueprint;
    const content = generateAgents(bp);
    expect(content).toContain("**Autonomy level:** high");
    expect(content).toContain("High autonomy");
  });

  it("each autonomy level produces correct delegation tiers", () => {
    // Test all three levels with real blueprints
    const levels: Array<{ name: string; level: string }> = [
      { name: "research-copilot", level: "low" },
      { name: "email-manager", level: "medium" },
      { name: "founders-ops", level: "high" },
    ];

    for (const { name, level } of levels) {
      const bp = loadBlueprint(name).blueprint;
      const content = generateAgents(bp);
      expect(content, `${name} should show ${level} autonomy`).toContain(`**Autonomy level:** ${level}`);
      expect(content, `${name} should have approval gates`).toContain("## Approval Gates");
      expect(content, `${name} should have execute tier`).toContain("### Execute");
      expect(content, `${name} should have propose tier`).toContain("### Propose");
      expect(content, `${name} should have approve tier`).toContain("### Approve");
    }
  });

  // ── Heartbeat behavior ─────────────────────────────────────────────────

  it("includes heartbeat behavior section", () => {
    const bp = loadEmailManager();
    const content = generateAgents(bp);
    expect(content).toContain("## Heartbeat Behavior");
    expect(content).toContain(`**Frequency:** ${bp.monitoring.heartbeat_frequency}`);
    expect(content).toContain(`**Quiet hours:** ${bp.monitoring.quiet_hours}`);
  });

  it("lists monitored checks in heartbeat section", () => {
    const bp = loadEmailManager();
    const content = generateAgents(bp);
    for (const check of bp.monitoring.checks) {
      expect(content).toContain(`Check ${check} integration health`);
    }
  });

  it("includes alert conditions in heartbeat section", () => {
    const bp = loadEmailManager();
    const content = generateAgents(bp);
    expect(content).toContain("**Alert on:**");
  });

  // ── Communication rules ────────────────────────────────────────────────

  it("includes communication rules section", () => {
    const bp = loadEmailManager();
    const content = generateAgents(bp);
    expect(content).toContain("## Communication Rules");
    expect(content).toContain("Respect quiet hours");
  });

  it("communication rules vary by autonomy level", () => {
    // Low autonomy: reactive
    const lowBp = loadBlueprint("research-copilot").blueprint;
    const lowContent = generateAgents(lowBp);
    expect(lowContent).toContain("Respond only when directly addressed");

    // Medium autonomy: balanced
    const medBp = loadEmailManager();
    const medContent = generateAgents(medBp);
    expect(medContent).toContain("Proactive notifications");

    // High autonomy: proactive
    const highBp = loadBlueprint("founders-ops").blueprint;
    const highContent = generateAgents(highBp);
    expect(highContent).toContain("Act autonomously on routine tasks");
  });

  // ── Standard Operating Procedures ────────────────────────────────────────

  it("includes session startup ritual with correct read order", () => {
    const bp = loadEmailManager();
    const content = generateAgents(bp);
    expect(content).toContain("### Session Startup Ritual");
    expect(content).toContain("1. **SOUL.md**");
    expect(content).toContain("2. **USER.md**");
    expect(content).toContain("3. **Daily memory**");
    expect(content).toContain("4. **MEMORY.md**");
    // Verify order: SOUL before USER before daily before MEMORY
    const soulIdx = content.indexOf("1. **SOUL.md**");
    const userIdx = content.indexOf("2. **USER.md**");
    const dailyIdx = content.indexOf("3. **Daily memory**");
    const memoryIdx = content.indexOf("4. **MEMORY.md**");
    expect(soulIdx).toBeLessThan(userIdx);
    expect(userIdx).toBeLessThan(dailyIdx);
    expect(dailyIdx).toBeLessThan(memoryIdx);
  });

  it("includes memory discipline section", () => {
    const bp = loadEmailManager();
    const content = generateAgents(bp);
    expect(content).toContain("### Memory Discipline");
    expect(content).toContain("memory/YYYY-MM-DD.md");
    expect(content).toContain("MEMORY.md");
    expect(content).toContain("USER.md");
    expect(content).toContain("Write it down or lose it");
  });

  it("includes data freshness rules for complex blueprints", () => {
    const bp = loadEmailManager();  // medium autonomy, has cron
    const content = generateAgents(bp);
    expect(content).toContain("### Data Freshness");
    expect(content).toContain("Verify before citing");
    expect(content).toContain("Stale data is worse than no data");
  });

  it("includes overnight batching when quiet_hours configured", () => {
    const bp = loadEmailManager();
    const content = generateAgents(bp);
    expect(content).toContain("### Overnight Batching");
    expect(content).toContain(bp.monitoring.quiet_hours);
    expect(content).toContain("Deliver ONE digest");
    expect(content).toContain("Never interrupt overnight");
  });

  it("includes cron role mapping table when cron_config has jobs", () => {
    const bp = loadEmailManager();
    const content = generateAgents(bp);
    expect(content).toContain("### Scheduled Jobs");
    expect(content).toContain("| Job | Schedule | Model | Session | Delivery |");
    expect(content).toContain("Heartbeat");
    expect(content).toContain("Work Session");
    expect(content).toContain("Morning Brief");
  });

  it("simple blueprints get 2 SOP sections, not all 5", () => {
    const bp = loadBlueprint("research-copilot").blueprint;
    const content = generateAgents(bp);
    // Simple: startup + memory discipline (2 sections)
    expect(content).toContain("### Session Startup Ritual");
    expect(content).toContain("### Memory Discipline");
    // Should NOT have complex sections
    expect(content).not.toContain("### Data Freshness");
    expect(content).not.toContain("### Overnight Batching");
    expect(content).not.toContain("### Scheduled Jobs");
  });

  it("complex blueprints get all 5 SOP sections", () => {
    const bp = loadEmailManager();  // medium autonomy, cron, quiet_hours
    const content = generateAgents(bp);
    expect(content).toContain("### Session Startup Ritual");
    expect(content).toContain("### Memory Discipline");
    expect(content).toContain("### Data Freshness");
    expect(content).toContain("### Overnight Batching");
    expect(content).toContain("### Scheduled Jobs");
  });

  it("SOP section is present in all blueprints", () => {
    const blueprintNames = [
      "email-manager", "family-hub", "founders-ops",
      "research-copilot", "stock-trading-assistant",
    ];
    for (const name of blueprintNames) {
      const bp = loadBlueprint(name).blueprint;
      const content = generateAgents(bp);
      expect(content, `${name} should have SOP section`).toContain("## Standard Operating Procedures");
      // All blueprints get at least startup + memory
      expect(content, `${name} should have startup ritual`).toContain("### Session Startup Ritual");
      expect(content, `${name} should have memory discipline`).toContain("### Memory Discipline");
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

  it("includes tool-specific quirks from integration registry", () => {
    const bp = loadEmailManager();
    const content = generateTools(bp);
    // Email manager has tools in the "email" category → should get email quirks
    expect(content).toContain("Email quirks:");
    expect(content).toContain("IMAP connections may drop silently");
  });

  it("includes calendar quirks when calendar tools present", () => {
    const bp = loadEmailManager();
    const content = generateTools(bp);
    // Email manager also has calendar tools
    expect(content).toContain("Calendar quirks:");
    expect(content).toContain("CalDAV sync can lag");
  });

  it("omits quirks for categories without known integrations", () => {
    const bp = loadEmailManager();
    const content = generateTools(bp);
    // Core tools have no matching integration → no quirks
    expect(content).not.toContain("Core quirks:");
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

  it("inlines blueprint-defined runbooks into AGENTS.md (not separate files)", () => {
    const bp = loadStockTrading();
    expect(bp.runbooks).toBeDefined();
    const files = generateIdentityFiles(bp);
    const names = files.map((f) => f.name);
    // Runbooks must NOT emit as separate files — their basenames aren't on
    // OpenClaw's 8-file auto-load allowlist, so they would silently fail to load.
    expect(names).not.toContain("RISK-GUARDRAILS.md");
    // Content must appear inside AGENTS.md so the agent actually reads it.
    const agents = files.find((f) => f.name === "AGENTS.md");
    expect(agents).toBeDefined();
    expect(agents?.content).toContain("Runbooks");
    expect(agents?.content).toContain("RISK GUARDRAILS");
  });

  it("inlined runbook content reaches AGENTS.md", () => {
    const bp = loadEmailManager();
    expect(bp.runbooks).toBeDefined();
    const files = generateIdentityFiles(bp);
    const agents = files.find((f) => f.name === "AGENTS.md");
    expect(agents).toBeDefined();
    expect(agents?.content).toContain("Priority Classification");
  });

  it("uses correct relative paths for all file types (workspace/ root, not identity/ subdir)", () => {
    const bp = loadEmailManager();
    const files = generateIdentityFiles(bp, undefined, {}, undefined, TEST_USER_CONTEXT);
    const paths = files.map((f) => f.relativePath);
    expect(paths).toContain("workspace/SOUL.md");
    expect(paths).toContain("workspace/AGENTS.md");
    expect(paths).toContain("workspace/TOOLS.md");
    expect(paths).toContain("workspace/USER.md");
    // Runbook content inlines into AGENTS.md — no separate file path.
    expect(paths).not.toContain("workspace/TRIAGE-RULES.md");
    expect(paths).not.toContain("workspace/identity/TRIAGE-RULES.md");
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

  it("token budget accounts for all identity files including inlined runbooks", () => {
    const bp = loadStockTrading();
    const files = generateIdentityFiles(bp, undefined, {}, undefined, TEST_USER_CONTEXT);
    // Runbooks inline into AGENTS.md, so exactly 4 files: SOUL, AGENTS, TOOLS, USER.
    expect(files.length).toBe(4);

    const totalSize = files.reduce(
      (sum, f) => sum + Buffer.byteLength(f.content, "utf-8"),
      0,
    );
    expect(totalSize).toBeLessThanOrEqual(20_000);

    // Runbook content must still be present — inside AGENTS.md.
    const agents = files.find((f) => f.name === "AGENTS.md");
    expect(agents?.content).toContain("Runbooks");
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

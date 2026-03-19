import { describe, expect, it } from "vitest";

import { loadBlueprint } from "../blueprints/loader.js";
import type { Blueprint } from "../blueprints/types.js";
import { generateAgents } from "../identity/agents.js";

import { generateToolWrappers } from "./index.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

function loadEmailManager(): Blueprint {
  return loadBlueprint("email-manager").blueprint;
}

function loadFoundersOps(): Blueprint {
  return loadBlueprint("founders-ops").blueprint;
}

function loadFamilyHub(): Blueprint {
  return loadBlueprint("family-hub").blueprint;
}

// ── All 7 Built-in Blueprints ───────────────────────────────────────────────

const ALL_BLUEPRINTS = [
  "email-manager",
  "family-hub",
  "founders-ops",
  "replace-chatgpt-plus",
  "replace-google-assistant",
  "replace-my-pa",
  "research-copilot",
] as const;

// ── Core Behavior ───────────────────────────────────────────────────────────

describe("generateToolWrappers", () => {
  it("generates a wrapper for every tool in the blueprint", () => {
    const bp = loadFoundersOps();
    const wrappers = generateToolWrappers(bp);
    const names = wrappers.map((w) => w.name);

    for (const tool of bp.toolbelt.tools) {
      expect(names, `missing wrapper for "${tool.name}"`).toContain(tool.name);
    }
  });

  it("generates exactly the number of tools in the blueprint", () => {
    const bp = loadEmailManager();
    const wrappers = generateToolWrappers(bp);
    expect(wrappers).toHaveLength(bp.toolbelt.tools.length);
  });

  it("uses correct relative paths", () => {
    const bp = loadEmailManager();
    const wrappers = generateToolWrappers(bp);
    for (const wrapper of wrappers) {
      expect(wrapper.relativePath).toBe(`workspace/tools/${wrapper.name}`);
    }
  });

  it("sets executable mode on all wrappers", () => {
    const bp = loadEmailManager();
    const wrappers = generateToolWrappers(bp);
    for (const wrapper of wrappers) {
      expect(wrapper.mode).toBe(0o755);
    }
  });

  it("generates scripts with a shebang line", () => {
    const bp = loadFoundersOps();
    const wrappers = generateToolWrappers(bp);
    for (const wrapper of wrappers) {
      expect(
        wrapper.content.startsWith("#!/"),
        `${wrapper.name} should start with a shebang`,
      ).toBe(true);
    }
  });

  it("generates non-empty content for all tools", () => {
    const bp = loadFoundersOps();
    const wrappers = generateToolWrappers(bp);
    for (const wrapper of wrappers) {
      expect(
        wrapper.content.length,
        `${wrapper.name} should have non-empty content`,
      ).toBeGreaterThan(100);
    }
  });
});

// ── All Blueprints ──────────────────────────────────────────────────────────

describe("generateToolWrappers — all blueprints", () => {
  it("generates wrappers for all 7 built-in blueprints", () => {
    for (const name of ALL_BLUEPRINTS) {
      const bp = loadBlueprint(name).blueprint;
      const wrappers = generateToolWrappers(bp);

      expect(
        wrappers.length,
        `${name} should produce tool wrappers`,
      ).toBeGreaterThan(0);

      expect(
        wrappers.length,
        `${name} wrapper count should match blueprint tool count`,
      ).toBe(bp.toolbelt.tools.length);
    }
  });

  it("all generated wrappers have valid shebangs", () => {
    for (const name of ALL_BLUEPRINTS) {
      const bp = loadBlueprint(name).blueprint;
      const wrappers = generateToolWrappers(bp);
      for (const wrapper of wrappers) {
        expect(
          wrapper.content,
          `${name}/${wrapper.name} should have a shebang`,
        ).toMatch(/^#!\/usr\/bin\/env (bash|python3)/);
      }
    }
  });
});

// ── Tool Name Consistency with AGENTS.md ────────────────────────────────────

describe("tool names match AGENTS.md references", () => {
  it("every generated tool name appears in AGENTS.md output", () => {
    for (const name of ALL_BLUEPRINTS) {
      const bp = loadBlueprint(name).blueprint;
      const wrappers = generateToolWrappers(bp);
      const agentsContent = generateAgents(bp);

      for (const wrapper of wrappers) {
        expect(
          agentsContent,
          `${name}: tool "${wrapper.name}" should be referenced in AGENTS.md`,
        ).toContain(wrapper.name);
      }
    }
  });
});

// ── Individual Tool Generators ──────────────────────────────────────────────

describe("email tool", () => {
  it("references himalaya", () => {
    const bp = loadEmailManager();
    const wrapper = generateToolWrappers(bp).find((w) => w.name === "email");
    expect(wrapper).toBeDefined();
    expect(wrapper!.content).toContain("himalaya");
  });

  it("includes usage help", () => {
    const bp = loadEmailManager();
    const wrapper = generateToolWrappers(bp).find((w) => w.name === "email");
    expect(wrapper!.content).toContain("usage()");
    expect(wrapper!.content).toContain("list");
    expect(wrapper!.content).toContain("read");
    expect(wrapper!.content).toContain("send");
  });
});

describe("ical tool", () => {
  it("is a python3 script", () => {
    const bp = loadFamilyHub();
    const wrapper = generateToolWrappers(bp).find((w) => w.name === "ical");
    expect(wrapper).toBeDefined();
    expect(wrapper!.content).toMatch(/^#!\/usr\/bin\/env python3/);
  });

  it("references caldav", () => {
    const bp = loadFamilyHub();
    const wrapper = generateToolWrappers(bp).find((w) => w.name === "ical");
    expect(wrapper!.content).toContain("caldav");
  });
});

describe("tasks tool", () => {
  it("manages a local JSON task queue", () => {
    const bp = loadEmailManager();
    const wrapper = generateToolWrappers(bp).find((w) => w.name === "tasks");
    expect(wrapper).toBeDefined();
    expect(wrapper!.content).toContain("tasks.json");
    expect(wrapper!.content).toContain("add");
    expect(wrapper!.content).toContain("done");
  });
});

describe("todoist tool", () => {
  it("uses Todoist REST API", () => {
    const bp = loadFoundersOps();
    const wrapper = generateToolWrappers(bp).find((w) => w.name === "todoist");
    expect(wrapper).toBeDefined();
    expect(wrapper!.content).toContain("api.todoist.com/rest/v2");
    expect(wrapper!.content).toContain("TODOIST_API_TOKEN");
  });
});

describe("todoist-sync tool", () => {
  it("checks for overdue tasks", () => {
    const bp = loadFoundersOps();
    const wrapper = generateToolWrappers(bp).find((w) => w.name === "todoist-sync");
    expect(wrapper).toBeDefined();
    expect(wrapper!.content).toContain("overdue");
    expect(wrapper!.content).toContain("due-today");
  });
});

describe("tavily tool", () => {
  it("uses Tavily search API", () => {
    const bp = loadFoundersOps();
    const wrapper = generateToolWrappers(bp).find((w) => w.name === "tavily");
    expect(wrapper).toBeDefined();
    expect(wrapper!.content).toContain("api.tavily.com");
    expect(wrapper!.content).toContain("TAVILY_API_KEY");
  });
});

describe("quote tool", () => {
  it("uses Yahoo Finance API", () => {
    const bp = loadFoundersOps();
    const wrapper = generateToolWrappers(bp).find((w) => w.name === "quote");
    expect(wrapper).toBeDefined();
    expect(wrapper!.content).toContain("finance.yahoo.com");
  });

  it("supports batch quotes", () => {
    const bp = loadFoundersOps();
    const wrapper = generateToolWrappers(bp).find((w) => w.name === "quote");
    expect(wrapper!.content).toContain("batch");
  });
});

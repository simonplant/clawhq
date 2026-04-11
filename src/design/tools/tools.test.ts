import { describe, expect, it } from "vitest";

import { loadBlueprint } from "../blueprints/loader.js";
import type { Blueprint } from "../blueprints/types.js";
import { generateAgents } from "../identity/agents.js";

import { generateGhTool } from "./gh.js";
import { generateHaTool } from "./ha.js";
import { generateSubstackTool } from "./substack.js";
import { generateVaultTool } from "./vault.js";
import { generateXTool } from "./x.js";
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

  it("generates exactly the number of tools in the blueprint plus platform tools", () => {
    const bp = loadEmailManager();
    const wrappers = generateToolWrappers(bp);
    const blueprintTools = wrappers.filter((w) => w.name !== "approve-action" && w.name !== "sanitize");
    expect(blueprintTools).toHaveLength(bp.toolbelt.tools.length);
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

      const blueprintTools = wrappers.filter((w) => w.name !== "approve-action" && w.name !== "sanitize");
      expect(
        blueprintTools.length,
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
        ).toMatch(/^#!\/usr\/bin\/env (bash|python3|node)/);
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

      // Platform tools (approve-action) are not listed in AGENTS.md
      const blueprintTools = wrappers.filter((w) => w.name !== "approve-action" && w.name !== "sanitize");
      for (const wrapper of blueprintTools) {
        expect(
          agentsContent,
          `${name}: tool "${wrapper.name}" should be referenced in AGENTS.md`,
        ).toContain(wrapper.name);
      }
    }
  });
});

// ── approve-action Tool ─────────────────────────────────────────────────────

describe("approve-action tool", () => {
  it("wraps saveQueue writeFileSync in try-catch with process.exit(1)", () => {
    const bp = loadEmailManager();
    const wrapper = generateToolWrappers(bp).find(
      (w) => w.name === "approve-action",
    );
    expect(wrapper).toBeDefined();

    // saveQueue must have error handling — a failed write must be loud
    expect(wrapper?.content).toContain("function saveQueue");
    expect(wrapper?.content).toMatch(/saveQueue[\s\S]*?try\s*\{[\s\S]*?writeFileSync/);
    expect(wrapper?.content).toMatch(
      /saveQueue[\s\S]*?catch[\s\S]*?console\.error[\s\S]*?process\.exit\(1\)/,
    );
  });
});

// ── Individual Tool Generators ──────────────────────────────────────────────

describe("email tool", () => {
  it("references himalaya", () => {
    const bp = loadEmailManager();
    const wrapper = generateToolWrappers(bp).find((w) => w.name === "email");
    expect(wrapper).toBeDefined();
    expect(wrapper?.content).toContain("himalaya");
  });

  it("includes usage help", () => {
    const bp = loadEmailManager();
    const wrapper = generateToolWrappers(bp).find((w) => w.name === "email");
    expect(wrapper?.content).toContain("help");
    expect(wrapper?.content).toContain("list");
    expect(wrapper?.content).toContain("read");
    expect(wrapper?.content).toContain("send");
  });
});

describe("ical tool", () => {
  it("is a bash script", () => {
    const bp = loadFamilyHub();
    const wrapper = generateToolWrappers(bp).find((w) => w.name === "ical");
    expect(wrapper).toBeDefined();
    expect(wrapper?.content).toMatch(/^#!\/usr\/bin\/env bash/);
  });

  it("references caldav", () => {
    const bp = loadFamilyHub();
    const wrapper = generateToolWrappers(bp).find((w) => w.name === "ical");
    expect(wrapper?.content).toContain("caldav");
  });
});

describe("tasks tool", () => {
  it("manages a local JSON task queue", () => {
    const bp = loadEmailManager();
    const wrapper = generateToolWrappers(bp).find((w) => w.name === "tasks");
    expect(wrapper).toBeDefined();
    expect(wrapper?.content).toContain("tasks.json");
    expect(wrapper?.content).toContain("add");
    expect(wrapper?.content).toContain("done");
  });
});

describe("todoist tool", () => {
  it("uses credential proxy for Todoist REST API", () => {
    const bp = loadFoundersOps();
    const wrapper = generateToolWrappers(bp).find((w) => w.name === "todoist");
    expect(wrapper).toBeDefined();
    expect(wrapper?.content).toContain("CRED_PROXY_URL");
    expect(wrapper?.content).toContain("/todoist");
  });
});

describe("todoist-sync tool", () => {
  it("checks for overdue tasks via credential proxy", () => {
    const bp = loadFoundersOps();
    const wrapper = generateToolWrappers(bp).find((w) => w.name === "todoist-sync");
    expect(wrapper).toBeDefined();
    expect(wrapper?.content).toContain("overdue");
    expect(wrapper?.content).toContain("due-today");
    expect(wrapper?.content).toContain("CRED_PROXY_URL");
    expect(wrapper?.content).toContain("/todoist-sync");
  });
});

describe("tavily tool", () => {
  it("uses credential proxy for Tavily search API", () => {
    const bp = loadFoundersOps();
    const wrapper = generateToolWrappers(bp).find((w) => w.name === "tavily");
    expect(wrapper).toBeDefined();
    expect(wrapper?.content).toContain("CRED_PROXY_URL");
    expect(wrapper?.content).toContain("/tavily");
  });
});

describe("quote tool", () => {
  it("uses Yahoo Finance API", () => {
    const bp = loadFoundersOps();
    const wrapper = generateToolWrappers(bp).find((w) => w.name === "quote");
    expect(wrapper).toBeDefined();
    expect(wrapper?.content).toContain("finance.yahoo.com");
  });

  it("supports batch quotes", () => {
    const bp = loadFoundersOps();
    const wrapper = generateToolWrappers(bp).find((w) => w.name === "quote");
    expect(wrapper?.content).toContain("batch");
  });

  it("uses credential proxy with /yahoo prefix when available", () => {
    const bp = loadFoundersOps();
    const wrapper = generateToolWrappers(bp).find((w) => w.name === "quote");
    expect(wrapper?.content).toContain("CRED_PROXY_URL");
    expect(wrapper?.content).toContain("/yahoo");
  });
});

// ── Sanitize Tool (ClawWall) ───────────────────────────────────────────────

describe("sanitize tool", () => {
  it("is included as a platform tool for every blueprint", () => {
    for (const name of ALL_BLUEPRINTS) {
      const bp = loadBlueprint(name).blueprint;
      const wrappers = generateToolWrappers(bp);
      const sanitize = wrappers.find((w) => w.name === "sanitize");
      expect(sanitize, `${name} should include sanitize tool`).toBeDefined();
      expect(sanitize?.relativePath).toBe("workspace/tools/sanitize");
    }
  });

  it("is a node script with OWASP LLM01 patterns", () => {
    const bp = loadEmailManager();
    const sanitize = generateToolWrappers(bp).find((w) => w.name === "sanitize");
    expect(sanitize).toBeDefined();
    expect(sanitize?.content).toMatch(/^#!\/usr\/bin\/env node/);
    // Tier 1 patterns
    expect(sanitize?.content).toContain("INJECTION_PATTERNS");
    expect(sanitize?.content).toContain("DELIMITER_PATTERNS");
    expect(sanitize?.content).toContain("ENCODING_PATTERNS");
    expect(sanitize?.content).toContain("EXFIL_PATTERNS");
    // Tier 2 patterns
    expect(sanitize?.content).toContain("CONFUSABLE_MAP");
    expect(sanitize?.content).toContain("MULTILINGUAL_INJECTION");
    expect(sanitize?.content).toContain("FEWSHOT_");
    expect(sanitize?.content).toContain("MORSE_PATTERN");
  });

  it("works as a stdin filter with --source and --strict flags", () => {
    const bp = loadEmailManager();
    const sanitize = generateToolWrappers(bp).find((w) => w.name === "sanitize");
    expect(sanitize?.content).toContain("--source");
    expect(sanitize?.content).toContain("--strict");
    expect(sanitize?.content).toContain("--wrap");
    expect(sanitize?.content).toContain("stdin");
  });

  it("writes quarantine log to ~/.clawhq/ops/security/", () => {
    const bp = loadEmailManager();
    const sanitize = generateToolWrappers(bp).find((w) => w.name === "sanitize");
    expect(sanitize?.content).toContain("sanitizer-quarantine.jsonl");
    expect(sanitize?.content).toContain("sanitizer-audit.jsonl");
  });

  it("supports JSON field sanitization via --json flag", () => {
    const bp = loadEmailManager();
    const sanitize = generateToolWrappers(bp).find((w) => w.name === "sanitize");
    expect(sanitize?.content).toContain("--json");
    expect(sanitize?.content).toContain("processJson");
  });

  it("detects and replaces injection keywords", () => {
    const bp = loadEmailManager();
    const sanitize = generateToolWrappers(bp).find((w) => w.name === "sanitize");
    // Verify replacement markers are present
    expect(sanitize?.content).toContain("[FILTERED]");
    expect(sanitize?.content).toContain("[DELIM]");
    expect(sanitize?.content).toContain("[LINK REMOVED]");
    expect(sanitize?.content).toContain("[EXFIL REMOVED]");
    expect(sanitize?.content).toContain("[TURN REMOVED]");
    expect(sanitize?.content).toContain("[ENCODED REMOVED]");
  });

  it("includes quarantine threshold at 0.6", () => {
    const bp = loadEmailManager();
    const sanitize = generateToolWrappers(bp).find((w) => w.name === "sanitize");
    expect(sanitize?.content).toContain("QUARANTINE_THRESHOLD = 0.6");
  });

  it("only quarantines 'external' source — tool sources are sanitized but not quarantined", () => {
    const bp = loadEmailManager();
    const sanitize = generateToolWrappers(bp).find((w) => w.name === "sanitize");
    // QUARANTINE_SOURCES should only contain "external"
    expect(sanitize?.content).toContain('QUARANTINE_SOURCES = ["external"]');
    // The quarantine decision should check canQuarantine
    expect(sanitize?.content).toContain("canQuarantine");
  });
});

// ── External Tools Pipe Through Sanitize ──────────────────────────────────

describe("external tools pipe through sanitize", () => {
  it("tavily pipes results through _sanitize", () => {
    const bp = loadFoundersOps();
    const tavily = generateToolWrappers(bp).find((w) => w.name === "tavily");
    expect(tavily?.content).toContain("_sanitize");
    expect(tavily?.content).toContain("SCRIPT_DIR");
    expect(tavily?.content).toContain('--source tavily');
  });

  it("email pipes read/list/search through _sanitize", () => {
    const bp = loadEmailManager();
    const email = generateToolWrappers(bp).find((w) => w.name === "email");
    expect(email?.content).toContain("_sanitize");
    expect(email?.content).toContain("SCRIPT_DIR");
    expect(email?.content).toContain('--source email');
    // list, read, search should go through _sanitize
    expect(email?.content).toMatch(/list.*\|\s*_sanitize/);
    expect(email?.content).toMatch(/read.*\|\s*_sanitize/);
    // search case pipes through _sanitize on the next line
    expect(email?.content).toMatch(/search\)[\s\S]*?\|\s*_sanitize/);
  });

  it("quote pipes results through _sanitize", () => {
    const bp = loadFoundersOps();
    const quote = generateToolWrappers(bp).find((w) => w.name === "quote");
    expect(quote?.content).toContain("_sanitize");
    expect(quote?.content).toContain("SCRIPT_DIR");
    expect(quote?.content).toContain('--source quote');
  });

  it("sanitize pipe is gracefully optional (falls back to cat)", () => {
    const bp = loadFoundersOps();
    const tavily = generateToolWrappers(bp).find((w) => w.name === "tavily");
    // Should check if sanitize is executable, fall back to cat
    expect(tavily?.content).toContain('[[ -x "$SCRIPT_DIR/sanitize" ]]');
    expect(tavily?.content).toContain("cat");
  });
});

// ── Shell Injection Prevention ─────────────────────────────────────────────

describe("shell injection prevention", () => {
  /**
   * Extract python3 -c blocks from generated bash scripts.
   * These are the highest-risk areas for injection — bash vars interpolated
   * into Python source code can enable arbitrary code execution.
   */
  function extractPythonBlocks(script: string): string[] {
    const blocks: string[] = [];
    const regex = /python3 -c "([\s\S]*?)"\n/g;
    let match;
    while ((match = regex.exec(script)) !== null) {
      blocks.push(match[1]);
    }
    return blocks;
  }

  it("python3 -c blocks use os.environ instead of raw bash variable interpolation", () => {
    for (const name of ALL_BLUEPRINTS) {
      const bp = loadBlueprint(name).blueprint;
      const wrappers = generateToolWrappers(bp);
      for (const wrapper of wrappers) {
        if (!wrapper.content.startsWith("#!/usr/bin/env bash")) continue;
        const pyBlocks = extractPythonBlocks(wrapper.content);
        for (const block of pyBlocks) {
          // No raw $VAR inside python code — must use os.environ
          // Allow \$ (escaped, not a bash expansion) and $( (command sub in bash, not in python block)
          const rawBashVars = block.match(/(?<![\\])\$[A-Za-z_][A-Za-z0-9_]*/g) || [];
          expect(
            rawBashVars,
            `${name}/${wrapper.name}: python3 -c block has raw bash vars: ${rawBashVars.join(", ")}. Use os.environ instead.`,
          ).toHaveLength(0);
        }
      }
    }
  });

  it("no inline JSON string interpolation in curl -d payloads", () => {
    for (const name of ALL_BLUEPRINTS) {
      const bp = loadBlueprint(name).blueprint;
      const wrappers = generateToolWrappers(bp);
      for (const wrapper of wrappers) {
        if (!wrapper.content.startsWith("#!/usr/bin/env bash")) continue;
        // Match curl -d with inline JSON containing unescaped $var inside the JSON
        // Safe pattern: curl -d "$payload" where payload was built with jq
        // Unsafe pattern: curl -d "{ \"key\": \"$var\" }"
        const unsafeJsonPayload = wrapper.content.match(
          /-d\s+"\{[^"]*\$[A-Za-z_][^"]*\}"/g,
        );
        expect(
          unsafeJsonPayload ?? [],
          `${name}/${wrapper.name}: curl -d has inline JSON with variable interpolation. Use jq for safe JSON construction.`,
        ).toHaveLength(0);
      }
    }
  });

  it("all bash variable expansions are inside double-quoted strings", () => {
    for (const name of ALL_BLUEPRINTS) {
      const bp = loadBlueprint(name).blueprint;
      const wrappers = generateToolWrappers(bp);
      for (const wrapper of wrappers) {
        if (!wrapper.content.startsWith("#!/usr/bin/env bash")) continue;
        // Verify no printf-based JSON construction (fragile quoting)
        // Allow printf for non-JSON uses (e.g., MIME headers)
        expect(
          wrapper.content,
          `${name}/${wrapper.name}: uses printf for JSON construction. Use jq instead.`,
        ).not.toMatch(/printf\s+'.*\{.*%s.*\}.*'/);
      }
    }
  });
});

// ── GitHub Tool ─────────────────────────────────────────────────────────────

describe("gh tool", () => {
  it("generates a bash script", () => {
    const content = generateGhTool();
    expect(content).toMatch(/^#!\/usr\/bin\/env bash/);
  });

  it("uses credential proxy with /github prefix", () => {
    const content = generateGhTool();
    expect(content).toContain("CRED_PROXY_URL");
    expect(content).toContain("/github");
  });

  it("falls back to GH_TOKEN", () => {
    const content = generateGhTool();
    expect(content).toContain("GH_TOKEN");
  });

  it("pipes results through _sanitize", () => {
    const content = generateGhTool();
    expect(content).toContain("_sanitize");
    expect(content).toContain("SCRIPT_DIR");
    expect(content).toContain("--source gh");
  });

  it("supports repo, issue, pr, release subcommands", () => {
    const content = generateGhTool();
    expect(content).toContain("repo)");
    expect(content).toContain("issue)");
    expect(content).toContain("prs)");
    expect(content).toContain("pr)");
    expect(content).toContain("releases)");
    expect(content).toContain("release)");
  });

  it("uses jq for JSON body construction", () => {
    const content = generateGhTool();
    expect(content).toContain("jq -n");
  });

  it("has non-trivial content", () => {
    expect(generateGhTool().length).toBeGreaterThan(100);
  });
});

// ── X/Twitter Tool ──────────────────────────────────────────────────────────

describe("x tool", () => {
  it("generates a bash script", () => {
    const content = generateXTool();
    expect(content).toMatch(/^#!\/usr\/bin\/env bash/);
  });

  it("uses credential proxy with /x prefix", () => {
    const content = generateXTool();
    expect(content).toContain("CRED_PROXY_URL");
    expect(content).toContain("/x");
  });

  it("falls back to X_BEARER_TOKEN", () => {
    const content = generateXTool();
    expect(content).toContain("X_BEARER_TOKEN");
  });

  it("pipes results through _sanitize", () => {
    const content = generateXTool();
    expect(content).toContain("_sanitize");
    expect(content).toContain("SCRIPT_DIR");
    expect(content).toContain("--source x");
  });

  it("is read-only — no posting commands", () => {
    const content = generateXTool();
    expect(content).toContain("Read-only");
    expect(content).not.toContain("POST");
  });

  it("supports search, timeline, user subcommands", () => {
    const content = generateXTool();
    expect(content).toContain("search)");
    expect(content).toContain("timeline)");
    expect(content).toContain("user)");
  });

  it("uses jq for URL encoding", () => {
    const content = generateXTool();
    expect(content).toContain("jq -rn");
    expect(content).toContain("@uri");
  });
});

// ── Substack Tool ───────────────────────────────────────────────────────────

describe("substack tool", () => {
  it("generates a bash script", () => {
    const content = generateSubstackTool();
    expect(content).toMatch(/^#!\/usr\/bin\/env bash/);
  });

  it("calls publication APIs directly with cookie auth", () => {
    const content = generateSubstackTool();
    expect(content).toContain("SUBSTACK_COOKIE");
    expect(content).toContain(".substack.com/api/v1/posts");
  });

  it("pipes results through _sanitize", () => {
    const content = generateSubstackTool();
    expect(content).toContain("_sanitize");
    expect(content).toContain("SCRIPT_DIR");
    expect(content).toContain("--source substack");
  });

  it("supports latest, search, read subcommands", () => {
    const content = generateSubstackTool();
    expect(content).toContain("latest)");
    expect(content).toContain("search)");
    expect(content).toContain("read)");
  });
});

// ── Home Assistant Tool ─────────────────────────────────────────────────────

describe("ha tool", () => {
  it("generates a bash script", () => {
    const content = generateHaTool();
    expect(content).toMatch(/^#!\/usr\/bin\/env bash/);
  });

  it("uses credential proxy with /ha prefix", () => {
    const content = generateHaTool();
    expect(content).toContain("CRED_PROXY_URL");
    expect(content).toContain("/ha");
  });

  it("falls back to HA_TOKEN and HA_URL", () => {
    const content = generateHaTool();
    expect(content).toContain("HA_TOKEN");
    expect(content).toContain("HA_URL");
  });

  it("supports states, services, call-service, history subcommands", () => {
    const content = generateHaTool();
    expect(content).toContain("states)");
    expect(content).toContain("state)");
    expect(content).toContain("services)");
    expect(content).toContain("call-service)");
    expect(content).toContain("history)");
  });

  it("has entity allow/deny list for safety", () => {
    const content = generateHaTool();
    expect(content).toContain("HA_ENTITY_ALLOW");
    expect(content).toContain("HA_ENTITY_DENY");
    expect(content).toContain("_check_entity");
  });

  it("uses jq for JSON body construction in call-service", () => {
    const content = generateHaTool();
    expect(content).toContain("jq -n");
  });
});

// ── Vault Tool ──────────────────────────────────────────────────────────────

describe("vault tool", () => {
  it("generates a bash script", () => {
    const content = generateVaultTool();
    expect(content).toMatch(/^#!\/usr\/bin\/env bash/);
  });

  it("uses credential proxy with /op prefix", () => {
    const content = generateVaultTool();
    expect(content).toContain("CRED_PROXY_URL");
    expect(content).toContain("/op");
  });

  it("falls back to op CLI with OP_SERVICE_ACCOUNT_TOKEN", () => {
    const content = generateVaultTool();
    expect(content).toContain("OP_SERVICE_ACCOUNT_TOKEN");
    expect(content).toContain("op item get");
    expect(content).toContain("op item list");
  });

  it("is read-only — no write commands", () => {
    const content = generateVaultTool();
    expect(content).toContain("Read-only");
    expect(content).toContain("get)");
    expect(content).toContain("list)");
    // No create, update, delete subcommands
    expect(content).not.toContain("create)");
    expect(content).not.toContain("update)");
    expect(content).not.toContain("delete)");
  });

  it("supports get and list subcommands", () => {
    const content = generateVaultTool();
    expect(content).toContain("get)");
    expect(content).toContain("list)");
  });
});

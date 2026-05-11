/**
 * Multi-agent compile contract — locks the shape `agents.list[]` takes
 * when a profile declares `agents:`.
 *
 * Why this test exists: M2 of the Sterling Gen-4 plan ships the
 * machinery that turns a profile's `agents:` declaration into an
 * `agents.list[]` array in openclaw.json. Subsequent milestones add
 * fields, agents, and per-agent overrides — this test fixes the shape
 * so M3-M5 changes can't silently drop fields or reorder behaviour.
 *
 * It's intentionally tight on sterling-gen4 (the only multi-agent
 * profile today) and forgiving on the general contract — every
 * multi-agent profile must emit a well-formed `agents.list[]`, but the
 * specific entries are profile-specific.
 */

import { describe, expect, it } from "vitest";

import { compile, buildAgentsList } from "./compiler.js";
import { loadAllProfiles, loadProfile } from "./loader.js";
import type { UserConfig } from "./types.js";

const IDENTITY_FILES = [
  "SOUL.md",
  "AGENTS.md",
  "USER.md",
  "TOOLS.md",
  "IDENTITY.md",
  "HEARTBEAT.md",
  "BOOTSTRAP.md",
  "MEMORY.md",
];

const TEST_USER: UserConfig = {
  name: "TestUser",
  timezone: "UTC",
  communication: "brief",
};

const DEPLOY_DIR = "/tmp/multi-agent-compile-test";

function compileOpenclawJson(profile: string): Record<string, unknown> {
  const result = compile({ profile }, TEST_USER, DEPLOY_DIR);
  const oc = result.files.find((f) => f.relativePath === "openclaw.json");
  if (!oc) throw new Error(`compile(${profile}) produced no openclaw.json`);
  return JSON.parse(oc.content) as Record<string, unknown>;
}

function compiledPaths(profile: string): string[] {
  return compile({ profile }, TEST_USER, DEPLOY_DIR).files.map(
    (f) => f.relativePath,
  );
}

describe("buildAgentsList — pure helper", () => {
  it("returns undefined for absent or empty profile.agents", () => {
    expect(buildAgentsList(undefined)).toBeUndefined();
    expect(buildAgentsList([])).toBeUndefined();
  });

  it("defaults workspace to the agent id when omitted", () => {
    const list = buildAgentsList([{ id: "markets" }]);
    expect(list?.[0]?.workspace).toBe("markets");
  });

  it("honors an explicit workspace path when supplied", () => {
    const list = buildAgentsList([
      { id: "markets", workspace: "trading/markets" },
    ]);
    expect(list?.[0]?.workspace).toBe("trading/markets");
  });

  it("passes through model as a string", () => {
    const list = buildAgentsList([{ id: "a", model: "ollama/gpt-oss:20b" }]);
    expect(list?.[0]?.model).toBe("ollama/gpt-oss:20b");
  });

  it("passes through model as a { primary, fallbacks } object", () => {
    const list = buildAgentsList([
      {
        id: "a",
        model: {
          primary: "openrouter/nvidia/nemotron-3-super-120b-a12b:free",
          fallbacks: ["openrouter/anthropic/claude-opus-4.7"],
        },
      },
    ]);
    expect(list?.[0]?.model).toEqual({
      primary: "openrouter/nvidia/nemotron-3-super-120b-a12b:free",
      fallbacks: ["openrouter/anthropic/claude-opus-4.7"],
    });
  });

  it("omits fields that were not declared (no undefined leaks)", () => {
    const list = buildAgentsList([{ id: "a" }]);
    const entry = list?.[0] as unknown as Record<string, unknown>;
    expect(entry).toBeDefined();
    expect(entry.model).toBeUndefined();
    expect(entry.tools).toBeUndefined();
    expect(entry.skills).toBeUndefined();
    expect(entry.sandbox).toBeUndefined();
    expect(entry.heartbeat).toBeUndefined();
    // workspace is always present (defaults to id)
    expect(entry.workspace).toBe("a");
  });
});

describe("sterling-gen4 compile contract (M2)", () => {
  const config = compileOpenclawJson("sterling-gen4");
  const agents = config.agents as
    | { list?: unknown[]; defaults?: Record<string, unknown> }
    | undefined;
  const list = agents?.list as Array<Record<string, unknown>> | undefined;

  it("emits agents.list[]", () => {
    expect(agents).toBeDefined();
    expect(list).toBeDefined();
    expect(Array.isArray(list)).toBe(true);
  });

  it("still emits agents.defaults alongside list", () => {
    // defaults must coexist with list — runtime falls back to defaults
    // for any field an agent omits in its override.
    expect(agents?.defaults).toBeDefined();
  });

  it("has exactly one agent during M2 (life-ops)", () => {
    // When M4 adds markets + vision, update this expectation. The test
    // exists so adding an agent is an explicit decision, not accidental.
    expect(list?.length).toBe(1);
    expect(list?.[0]?.id).toBe("life-ops");
    expect(list?.[0]?.default).toBe(true);
  });

  it("the life-ops agent declares its own model.primary", () => {
    expect(list?.[0]?.model).toBe("ollama/gpt-oss:20b");
  });

  it("life-ops agent workspace defaults to its id", () => {
    expect(list?.[0]?.workspace).toBe("life-ops");
  });
});

describe("sterling-gen4 workspace partitioning (M3)", () => {
  const paths = compiledPaths("sterling-gen4");

  it("emits all 8 identity files under workspace/life-ops/", () => {
    for (const name of IDENTITY_FILES) {
      expect(paths).toContain(`workspace/life-ops/${name}`);
    }
  });

  it("does NOT emit identity files at the workspace root", () => {
    // Multi-agent profiles isolate identity per agent; root-level files
    // would mean ambiguous ownership and a path that no agent reads.
    for (const name of IDENTITY_FILES) {
      expect(paths).not.toContain(`workspace/${name}`);
    }
  });

  it("still emits shared tool configs at workspace/config/", () => {
    // Tool configs (substack-aliases, himalaya/config.toml) stay at the
    // single workspace root — they're shared infrastructure, not per-
    // agent state. Subagent fan-out and tool plumbing rely on this.
    expect(paths).toContain("workspace/config/substack-aliases.json");
  });
});

describe("single-agent emit unchanged (M3 regression guard)", () => {
  const paths = compiledPaths("life-ops");

  it("still emits identity files flat at workspace/", () => {
    for (const name of IDENTITY_FILES) {
      expect(paths).toContain(`workspace/${name}`);
    }
  });

  it("does NOT emit per-agent subdirectories", () => {
    // life-ops is single-agent — any workspace/<id>/SOUL.md would be a
    // regression of the workspace-partition fix.
    const perAgent = paths.filter((p) =>
      /^workspace\/[^/]+\/SOUL\.md$/.test(p),
    );
    expect(perAgent).toEqual([]);
  });
});

describe("multi-agent profile general contract", () => {
  // Every profile with a non-empty `agents:` field must produce a
  // well-formed agents.list[]: every entry has an id and a workspace,
  // ids are unique, and at most one entry has default:true.

  const profiles = loadAllProfiles().filter((p) => (p.agents?.length ?? 0) > 0);

  it("at least one multi-agent profile exists", () => {
    expect(profiles.length).toBeGreaterThan(0);
  });

  for (const profile of profiles) {
    describe(`[${profile.id}]`, () => {
      const loaded = loadProfile(profile.id);
      const list = buildAgentsList(loaded.agents);

      it("emits a non-empty agents list", () => {
        expect(list).toBeDefined();
        expect(list?.length).toBeGreaterThan(0);
      });

      it("every entry has id + workspace", () => {
        for (const entry of list ?? []) {
          expect(typeof entry.id).toBe("string");
          expect(entry.id.length).toBeGreaterThan(0);
          expect(typeof entry.workspace).toBe("string");
          expect(entry.workspace.length).toBeGreaterThan(0);
        }
      });

      it("ids are unique within the profile", () => {
        const ids = (list ?? []).map((e) => e.id);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it("at most one entry marks default: true", () => {
        const defaults = (list ?? []).filter((e) => e.default === true);
        expect(defaults.length).toBeLessThanOrEqual(1);
      });
    });
  }
});

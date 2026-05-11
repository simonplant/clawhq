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

import {
  buildAgentsList,
  collectAgentProviders,
  compile,
} from "./compiler.js";
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

describe("sterling-gen4 compile contract (M4)", () => {
  const config = compileOpenclawJson("sterling-gen4");
  const agents = config.agents as
    | { list?: unknown[]; defaults?: Record<string, unknown> }
    | undefined;
  const list = agents?.list as Array<Record<string, unknown>> | undefined;
  const byId = new Map((list ?? []).map((e) => [e.id as string, e]));

  it("emits agents.list[] alongside agents.defaults", () => {
    expect(agents).toBeDefined();
    expect(list).toBeDefined();
    expect(Array.isArray(list)).toBe(true);
    expect(agents?.defaults).toBeDefined();
  });

  it("has exactly three agents (life-ops, markets, vision)", () => {
    // Adding/removing agents from sterling-gen4 is an explicit decision.
    // Update this expectation alongside the YAML — it's the audit trail.
    expect(list?.length).toBe(3);
    expect(byId.has("life-ops")).toBe(true);
    expect(byId.has("markets")).toBe(true);
    expect(byId.has("vision")).toBe(true);
  });

  it("life-ops is the default agent", () => {
    expect(byId.get("life-ops")?.default).toBe(true);
    expect(byId.get("markets")?.default).toBeUndefined();
    expect(byId.get("vision")?.default).toBeUndefined();
  });

  it("life-ops uses gpt-oss with OpenRouter fallbacks", () => {
    const model = byId.get("life-ops")?.model as {
      primary: string;
      fallbacks: string[];
    };
    expect(model.primary).toBe("ollama/gpt-oss:20b");
    expect(model.fallbacks).toContain(
      "openrouter/nvidia/nemotron-3-super-120b-a12b:free",
    );
    expect(model.fallbacks).toContain("openrouter/anthropic/claude-sonnet-4.6");
  });

  it("markets primaries OpenRouter Nemotron Super with paid + Opus fallbacks", () => {
    const model = byId.get("markets")?.model as {
      primary: string;
      fallbacks: string[];
    };
    expect(model.primary).toBe(
      "openrouter/nvidia/nemotron-3-super-120b-a12b:free",
    );
    expect(model.fallbacks).toEqual([
      "openrouter/nvidia/nemotron-3-super-120b-a12b",
      "openrouter/anthropic/claude-opus-4.7",
    ]);
  });

  it("vision uses qwen2.5vl as a bare string (no fallback)", () => {
    // Vision content stays fully local — no remote fallback exists, so
    // the model is declared as a string (strict-no-fallback per upstream
    // model-failover semantics).
    expect(byId.get("vision")?.model).toBe("ollama/qwen2.5vl:32b-q4_K_M");
  });

  it("vision is sandboxed per-agent", () => {
    expect(byId.get("vision")?.sandbox).toEqual({
      mode: "all",
      scope: "agent",
    });
  });

  it("every agent's workspace defaults to its id", () => {
    expect(byId.get("life-ops")?.workspace).toBe("life-ops");
    expect(byId.get("markets")?.workspace).toBe("markets");
    expect(byId.get("vision")?.workspace).toBe("vision");
  });

  it("models.providers includes openrouter (referenced by life-ops and markets)", () => {
    const models = config.models as
      | { providers?: Record<string, { baseUrl?: string; apiKey?: string }> }
      | undefined;
    expect(models?.providers?.openrouter).toBeDefined();
    expect(models?.providers?.openrouter?.baseUrl).toBe(
      "https://openrouter.ai/api/v1",
    );
    // ApiKey is an env var reference, not a literal — the secret stays
    // in .env and is substituted at runtime.
    expect(models?.providers?.openrouter?.apiKey).toBe("${OPENROUTER_API_KEY}");
  });

  it("models.providers does NOT include anthropic directly (we use openrouter's proxy)", () => {
    // Fallback chain uses "openrouter/anthropic/..." — that's
    // anthropic-via-openrouter, not direct anthropic API. The compiler
    // should not synthesize an extra anthropic provider.
    const models = config.models as
      | { providers?: Record<string, unknown> }
      | undefined;
    expect(models?.providers?.anthropic).toBeUndefined();
  });
});

describe("collectAgentProviders — pure helper", () => {
  it("returns empty set for absent or empty profile.agents", () => {
    expect(collectAgentProviders(undefined).size).toBe(0);
    expect(collectAgentProviders([]).size).toBe(0);
  });

  it("collects the provider prefix from string model declarations", () => {
    const set = collectAgentProviders([
      { id: "a", model: "ollama/gpt-oss:20b" },
      { id: "b", model: "openrouter/anthropic/claude-opus-4.7" },
    ]);
    expect([...set].sort()).toEqual(["ollama", "openrouter"]);
  });

  it("collects providers from object model.primary + fallbacks", () => {
    const set = collectAgentProviders([
      {
        id: "a",
        model: {
          primary: "ollama/gpt-oss:20b",
          fallbacks: [
            "openrouter/nvidia/nemotron-3-super-120b-a12b:free",
            "openrouter/anthropic/claude-sonnet-4.6",
          ],
        },
      },
    ]);
    expect([...set].sort()).toEqual(["ollama", "openrouter"]);
  });

  it("dedupes across agents", () => {
    const set = collectAgentProviders([
      { id: "a", model: "openrouter/anthropic/claude-opus-4.7" },
      { id: "b", model: "openrouter/nvidia/nemotron-3-super-120b-a12b:free" },
    ]);
    expect(set.size).toBe(1);
    expect(set.has("openrouter")).toBe(true);
  });

  it("ignores agents without a model field (they inherit defaults)", () => {
    const set = collectAgentProviders([{ id: "a" }, { id: "b" }]);
    expect(set.size).toBe(0);
  });
});

describe("sterling-gen4 workspace partitioning (M3+M4)", () => {
  const paths = compiledPaths("sterling-gen4");

  it("emits all 8 identity files under each agent's workspace subdir", () => {
    for (const agentId of ["life-ops", "markets", "vision"]) {
      for (const name of IDENTITY_FILES) {
        expect(paths).toContain(`workspace/${agentId}/${name}`);
      }
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

describe("per-agent identity differentiation (M6)", () => {
  function readIdentity(profile: string, agentId: string): string {
    const r = compile({ profile }, TEST_USER, DEPLOY_DIR);
    const f = r.files.find(
      (x) => x.relativePath === `workspace/${agentId}/IDENTITY.md`,
    );
    if (!f) throw new Error(`no IDENTITY.md for ${agentId}`);
    return f.content;
  }

  it("each agent's IDENTITY.md carries an Agent Role section", () => {
    for (const id of ["life-ops", "markets", "vision"]) {
      const content = readIdentity("sterling-gen4", id);
      expect(content).toContain("## Agent Role");
    }
  });

  it("the Agent Role section reflects the per-agent description", () => {
    expect(readIdentity("sterling-gen4", "life-ops")).toContain(
      "email triage, calendar conflicts",
    );
    expect(readIdentity("sterling-gen4", "markets")).toContain(
      "Trading research",
    );
    expect(readIdentity("sterling-gen4", "vision")).toContain(
      "Multimodal agent",
    );
  });

  it("per-agent IDENTITY.md content differs across agents", () => {
    const lifeOps = readIdentity("sterling-gen4", "life-ops");
    const markets = readIdentity("sterling-gen4", "markets");
    const vision = readIdentity("sterling-gen4", "vision");
    expect(lifeOps).not.toBe(markets);
    expect(lifeOps).not.toBe(vision);
    expect(markets).not.toBe(vision);
  });

  it("single-agent IDENTITY.md has NO Agent Role section (parity guard)", () => {
    // life-ops single-agent must keep producing identical output —
    // otherwise the parity digest breaks.
    const r = compile(
      { profile: "life-ops" },
      TEST_USER,
      DEPLOY_DIR,
    );
    const f = r.files.find((x) => x.relativePath === "workspace/IDENTITY.md");
    if (!f) throw new Error("no IDENTITY.md for life-ops");
    expect(f.content).not.toContain("## Agent Role");
  });
});

describe("cron routing (M5)", () => {
  function compiledCron(profile: string): Record<string, unknown> {
    const r = compile({ profile }, TEST_USER, DEPLOY_DIR);
    const cron = r.files.find((f) => f.relativePath === "cron/jobs.json");
    if (!cron) throw new Error(`compile(${profile}) produced no cron/jobs.json`);
    return JSON.parse(cron.content) as Record<string, unknown>;
  }

  it("multi-agent cron carries agentId on every job", () => {
    // Profile-level cron routes to the default agent; per-agent cron
    // (M7) routes to its declaring agent. Either way, every job has
    // an agentId — the runtime never has to guess.
    const cron = compiledCron("sterling-gen4");
    const jobs = (cron.jobs as Array<Record<string, unknown>>) ?? [];
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      expect(job.agentId).toBeDefined();
      expect(typeof job.agentId).toBe("string");
    }
  });

  it("profile-level cron routes to the default agent (life-ops)", () => {
    // "heartbeat" comes from sterling-gen4's cron_defaults.
    const cron = compiledCron("sterling-gen4");
    const jobs = (cron.jobs as Array<Record<string, unknown>>) ?? [];
    const heartbeat = jobs.find((j) => j.id === "heartbeat");
    expect(heartbeat?.agentId).toBe("life-ops");
  });

  it("per-agent cron routes to its declaring agent (markets)", () => {
    // sterling-gen4's markets agent declares market-hours-pulse.
    const cron = compiledCron("sterling-gen4");
    const jobs = (cron.jobs as Array<Record<string, unknown>>) ?? [];
    const marketsCron = jobs.find((j) => j.id === "markets-market-hours-pulse");
    expect(marketsCron).toBeDefined();
    expect(marketsCron?.agentId).toBe("markets");
  });

  it("cron model field reflects the routed agent's effective primary", () => {
    // life-ops primary is gpt-oss; markets primary is OpenRouter.
    // The cron's `model` payload must match the agent it's routed to,
    // or the runtime would override the agent's declared primary on
    // every cron tick.
    const cron = compiledCron("sterling-gen4");
    const jobs = (cron.jobs as Array<Record<string, unknown>>) ?? [];
    const heartbeat = jobs.find((j) => j.id === "heartbeat");
    const heartbeatPayload = heartbeat?.payload as { model: string };
    expect(heartbeatPayload.model).toBe("ollama/gpt-oss:20b");
    const marketsCron = jobs.find((j) => j.id === "markets-market-hours-pulse");
    const marketsPayload = marketsCron?.payload as { model: string };
    expect(marketsPayload.model).toBe(
      "openrouter/nvidia/nemotron-3-super-120b-a12b:free",
    );
  });

  it("single-agent cron does NOT emit agentId", () => {
    // Backward-compat — single-agent profiles never had agentId; adding
    // it would change the byte sequence locked by the parity digest.
    const cron = compiledCron("life-ops");
    const jobs = (cron.jobs as Array<Record<string, unknown>>) ?? [];
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      expect(job.agentId).toBeUndefined();
    }
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

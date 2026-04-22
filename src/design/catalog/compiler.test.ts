import { describe, expect, it } from "vitest";

import { OLLAMA_DEFAULT_MODEL } from "../../config/defaults.js";

import type { UserConfig } from "./types.js";

import { compile } from "./index.js";

const TEST_USER: UserConfig = {
  name: "TestUser",
  timezone: "UTC",
  communication: "brief",
};

// ── Compilation Output ──────────────────────────────────────────────────────

describe("compile", () => {
  it("produces workspace identity files", () => {
    const result = compile({ profile: "life-ops", personality: "digital-assistant" }, TEST_USER, "/tmp/test");
    const paths = result.files.map((f) => f.relativePath);
    expect(paths).toContain("workspace/SOUL.md");
    expect(paths).toContain("workspace/AGENTS.md");
    expect(paths).toContain("workspace/USER.md");
    expect(paths).toContain("workspace/TOOLS.md");
  });

  it("produces runtime config files", () => {
    const result = compile({ profile: "life-ops", personality: "digital-assistant" }, TEST_USER, "/tmp/test");
    const paths = result.files.map((f) => f.relativePath);
    expect(paths).toContain("openclaw.json");
    expect(paths).toContain(".env");
    expect(paths).toContain("cron/jobs.json");
  });

  // Regression guard for the 20260421 clobber: compile() must NOT emit the
  // seeded-once / build-owned files that non-apply writeBundle callers
  // would otherwise write. `clawhq.yaml` is owned by scaffold/user;
  // `engine/docker-compose.yml` is owned by `clawhq build`. Both emissions
  // historically caused stub-clobber bugs.
  it("does not emit clawhq.yaml or docker-compose.yml (single-writer ownership)", () => {
    const result = compile({ profile: "life-ops", personality: "digital-assistant" }, TEST_USER, "/tmp/test");
    const paths = result.files.map((f) => f.relativePath);
    expect(paths).not.toContain("clawhq.yaml");
    expect(paths).not.toContain("engine/docker-compose.yml");
  });

  it("generates tool scripts for all profile tools", () => {
    const result = compile({ profile: "life-ops", personality: "digital-assistant" }, TEST_USER, "/tmp/test");
    // Tool scripts live at workspace/<name> (one level deep, no extension)
    const toolFiles = result.files.filter((f) => {
      if (!f.relativePath.startsWith("workspace/")) return false;
      if (f.relativePath.endsWith(".md")) return false;
      // Exclude skills (workspace/skills/...) and other nested paths
      const afterWorkspace = f.relativePath.slice("workspace/".length);
      return !afterWorkspace.includes("/");
    });
    // life-ops has: email, calendar, tasks, backlog, search, quote, x, substack + sanitize
    const toolNames = toolFiles.map((f) => f.relativePath.replace("workspace/", ""));
    expect(toolNames).toContain("sanitize");
    expect(toolNames).toContain("email");
    expect(toolNames).toContain("search");
    expect(toolNames).toContain("quote");
    expect(toolNames).toContain("x");
    expect(toolNames).toContain("substack");
  });

  // Compose security hardening is asserted by the build/docker/compose tests,
  // which test the single authoritative writer (clawhq build). compile() no
  // longer emits compose — see the regression test above.

  it("generates proxy files when env vars match builtin routes", () => {
    // Provide existing env with a credential that matches a proxy route
    const result = compile(
      { profile: "life-ops", personality: "digital-assistant" },
      TEST_USER,
      "/tmp/test",
      18789,
      { TAVILY_API_KEY: "test-key" },
    );
    const paths = result.files.map((f) => f.relativePath);
    expect(paths).toContain("engine/cred-proxy.js");
    expect(paths).toContain("engine/cred-proxy-routes.json");
  });

  it("includes CRED_PROXY_URL in .env when proxy is enabled", () => {
    const result = compile(
      { profile: "life-ops", personality: "digital-assistant" },
      TEST_USER,
      "/tmp/test",
      18789,
      { TAVILY_API_KEY: "test-key" },
    );
    const envFile = result.files.find((f) => f.relativePath === ".env");
    expect(envFile?.content).toContain("CRED_PROXY_URL");
    expect(envFile?.content).toContain("cred-proxy:9876");
  });

  it("always generates proxy files (yahoo no-auth route is always active)", () => {
    // The yahoo route uses type: "none" which always passes filtering,
    // so proxy is always enabled — this is by design for egress control
    const result = compile(
      { profile: "life-ops", personality: "digital-assistant" },
      TEST_USER,
      "/tmp/test",
    );
    const paths = result.files.map((f) => f.relativePath);
    expect(paths).toContain("engine/cred-proxy.js");
    expect(paths).toContain("engine/cred-proxy-routes.json");
  });

  it("tool registry is unified — compiler uses same generators as tools/index", () => {
    const result = compile({ profile: "life-ops", personality: "digital-assistant" }, TEST_USER, "/tmp/test");
    // The quote tool should have the proxy-first pattern from quote.ts
    const quoteTool = result.files.find((f) => f.relativePath === "workspace/quote");
    expect(quoteTool).toBeDefined();
    expect(quoteTool?.content).toContain("CRED_PROXY_URL");
    expect(quoteTool?.content).toContain("/yahoo");
  });

  it("includes allowlist with profile egress domains", () => {
    const result = compile({ profile: "life-ops", personality: "digital-assistant" }, TEST_USER, "/tmp/test");
    const allowlist = result.files.find((f) => f.relativePath === "ops/firewall/allowlist.yaml");
    expect(allowlist).toBeDefined();
    expect(allowlist?.content).toContain("api.todoist.com");
    expect(allowlist?.content).toContain("api.tavily.com");
  });

  it("adds provider egress domains to allowlist", () => {
    const result = compile(
      { profile: "life-ops", personality: "digital-assistant", providers: { email: "gmail" } },
      TEST_USER,
      "/tmp/test",
    );
    const allowlist = result.files.find((f) => f.relativePath === "ops/firewall/allowlist.yaml");
    expect(allowlist?.content).toContain("imap.gmail.com");
  });

  it("emits ollama model entry with contextWindow when modelContextWindow is set", () => {
    const result = compile(
      {
        profile: "life-ops",
        personality: "digital-assistant",
        model: "ollama/qwen2.5:14b",
        modelContextWindow: 16384,
      },
      TEST_USER,
      "/tmp/test",
    );
    const openclaw = result.files.find((f) => f.relativePath === "openclaw.json");
    expect(openclaw).toBeDefined();
    const parsed = JSON.parse(openclaw!.content) as {
      agents: { defaults: { model: { primary: string } } };
      models: {
        providers: {
          ollama: { models: Array<{ id: string; name: string; contextWindow: number }> };
        };
      };
    };
    expect(parsed.agents.defaults.model.primary).toBe("ollama/qwen2.5:14b");
    expect(parsed.models.providers.ollama.models).toEqual([
      { id: "qwen2.5:14b", name: "qwen2.5:14b", contextWindow: 16384 },
    ]);
  });

  it("omits ollama model entry when modelContextWindow is not set", () => {
    const result = compile(
      { profile: "life-ops", personality: "digital-assistant" },
      TEST_USER,
      "/tmp/test",
    );
    const openclaw = result.files.find((f) => f.relativePath === "openclaw.json");
    const parsed = JSON.parse(openclaw!.content) as {
      models: { providers: { ollama: { models: unknown[] } } };
    };
    expect(parsed.models.providers.ollama.models).toEqual([]);
  });

  // ── LLM-maintained knowledge base (wiki pattern) ───────────────────────────

  it("AGENTS.md emits a Knowledge Bases section when wiki-<kb>-ingest skills are present", () => {
    // life-ops declares wiki-trading-ingest/query/review — should produce a trading KB section
    const result = compile({ profile: "life-ops", personality: "digital-assistant" }, TEST_USER, "/tmp/test");
    const agents = result.files.find((f) => f.relativePath === "workspace/AGENTS.md");
    expect(agents).toBeDefined();
    const content = agents!.content;
    expect(content).toContain("## Knowledge Bases");
    expect(content).toContain("knowledge/trading/");
    expect(content).toContain("`wiki-trading-ingest`");
    expect(content).toContain("`wiki-trading-query`");
    expect(content).toContain("`wiki-trading-review`");
    // Emits the correct CLI flag — context/doctor take --path, not --name
    expect(content).toContain("llm-wiki context --path knowledge/trading");
    expect(content).not.toContain("llm-wiki context --name");
  });

  it("BOOTSTRAP.md directs the agent to read state/wiki-context.md when a KB is present", () => {
    // Regression: previously pointed at `workspace/state/wiki-context.md`,
    // but the fs tool's workspaceOnly base IS the workspace directory, so
    // the `workspace/` prefix doubled the path and the Read tool failed
    // on every session start.
    const result = compile({ profile: "life-ops", personality: "digital-assistant" }, TEST_USER, "/tmp/test");
    const bootstrap = result.files.find((f) => f.relativePath === "workspace/BOOTSTRAP.md");
    expect(bootstrap).toBeDefined();
    expect(bootstrap!.content).toContain("state/wiki-context.md");
    expect(bootstrap!.content).not.toContain("workspace/state/wiki-context.md");
    expect(bootstrap!.content).toContain("`trading`");
  });

  it("cron/jobs.json does NOT auto-schedule event-driven wiki-*-ingest/query skills", () => {
    const result = compile({ profile: "life-ops", personality: "digital-assistant" }, TEST_USER, "/tmp/test");
    const cron = result.files.find((f) => f.relativePath === "cron/jobs.json");
    expect(cron).toBeDefined();
    const parsed = JSON.parse(cron!.content) as { jobs: Array<{ id: string }> };
    const ids = parsed.jobs.map((j) => j.id);
    // Ingest and query are event-driven — should not appear as auto-scheduled skill-* crons
    expect(ids).not.toContain("skill-wiki-trading-ingest");
    expect(ids).not.toContain("skill-wiki-trading-query");
    // Review has its own cron_defaults entry — should appear under its real id
    expect(ids).toContain("wiki-trading-review");
    // Session-start briefing refresh cron must exist
    expect(ids).toContain("wiki-context-refresh");
  });

  it("wiki-context-refresh cron invokes llm-wiki with workspace-relative paths", () => {
    // Regression: shell commands inside the container run with CWD = workspace,
    // so `workspace/…` prefixes create doubled paths (`workspace/workspace/…`)
    // that the fs tool can't find on session start.
    const result = compile({ profile: "life-ops", personality: "digital-assistant" }, TEST_USER, "/tmp/test");
    const cron = result.files.find((f) => f.relativePath === "cron/jobs.json");
    const parsed = JSON.parse(cron!.content) as { jobs: Array<{ id: string; payload: { message: string } }> };
    const refresh = parsed.jobs.find((j) => j.id === "wiki-context-refresh");
    expect(refresh).toBeDefined();
    expect(refresh!.payload.message).toContain("llm-wiki context");
    expect(refresh!.payload.message).toContain("--path knowledge/trading");
    expect(refresh!.payload.message).toContain("state/wiki-context.md");
    expect(refresh!.payload.message).not.toContain("workspace/knowledge/trading");
    expect(refresh!.payload.message).not.toContain("workspace/state/wiki-context.md");
  });

  it("applies modelFallbacks override", () => {
    const result = compile(
      {
        profile: "life-ops",
        personality: "digital-assistant",
        model: "ollama/qwen2.5:14b",
        modelFallbacks: [`ollama/${OLLAMA_DEFAULT_MODEL}`],
      },
      TEST_USER,
      "/tmp/test",
    );
    const openclaw = result.files.find((f) => f.relativePath === "openclaw.json");
    const parsed = JSON.parse(openclaw!.content) as {
      agents: { defaults: { model: { primary: string; fallbacks: string[] } } };
    };
    expect(parsed.agents.defaults.model.fallbacks).toEqual([`ollama/${OLLAMA_DEFAULT_MODEL}`]);
  });
});

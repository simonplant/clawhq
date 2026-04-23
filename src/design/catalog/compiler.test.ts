import { describe, expect, it } from "vitest";

import { OLLAMA_DEFAULT_MODEL } from "../../config/defaults.js";

import type { UserConfig } from "./types.js";

import { compile } from "./index.js";

const TEST_USER: UserConfig = {
  name: "TestUser",
  timezone: "UTC",
  communication: "brief",
};

function findFile(files: readonly { relativePath: string; content: string }[], path: string): { relativePath: string; content: string } {
  const f = files.find((x) => x.relativePath === path);
  if (!f) throw new Error(`compiled bundle missing ${path}`);
  return f;
}

// ── Compilation Output ──────────────────────────────────────────────────────

describe("compile", () => {
  it("produces workspace identity files", () => {
    const result = compile({ profile: "life-ops" }, TEST_USER, "/tmp/test");
    const paths = result.files.map((f) => f.relativePath);
    expect(paths).toContain("workspace/SOUL.md");
    expect(paths).toContain("workspace/AGENTS.md");
    expect(paths).toContain("workspace/USER.md");
    expect(paths).toContain("workspace/TOOLS.md");
  });

  it("produces runtime config files", () => {
    const result = compile({ profile: "life-ops" }, TEST_USER, "/tmp/test");
    const paths = result.files.map((f) => f.relativePath);
    expect(paths).toContain("openclaw.json");
    expect(paths).toContain(".env");
    expect(paths).toContain("cron/jobs.json");
  });

  // Regression guard for the 20260421 clobber: compile() must NOT emit the
  // seeded-once / user-owned files that non-apply writeBundle callers
  // would otherwise write. `clawhq.yaml` is owned by scaffold/user;
  // historical emission caused stub-clobber bugs. docker-compose.yml is
  // emitted here — apply writes it, `clawhq build` is image-only.
  it("does not emit clawhq.yaml (seeded-once ownership)", () => {
    const result = compile({ profile: "life-ops" }, TEST_USER, "/tmp/test");
    const paths = result.files.map((f) => f.relativePath);
    expect(paths).not.toContain("clawhq.yaml");
  });

  it("emits engine/docker-compose.yml with the required landmine shape", () => {
    const result = compile({ profile: "life-ops" }, TEST_USER, "/tmp/test");
    const compose = result.files.find((f) => f.relativePath === "engine/docker-compose.yml");
    expect(compose).toBeDefined();
    // Sanity check: file should carry the security-critical hardening
    // we rely on preflight + landmine validators to enforce.
    expect(compose?.content).toContain("cap_drop:");
    expect(compose?.content).toContain("- ALL");
    expect(compose?.content).toContain("no-new-privileges");
    expect(compose?.content).toContain('user: "1000:1000"');
    // Mode 0o600 — compose carries container image tags + host paths,
    // treated as sensitive config.
    expect(compose?.mode).toBe(0o600);
  });

  it("generates tool scripts for all profile tools", () => {
    const result = compile({ profile: "life-ops" }, TEST_USER, "/tmp/test");
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
      { profile: "life-ops" },
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
      { profile: "life-ops" },
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
      { profile: "life-ops" },
      TEST_USER,
      "/tmp/test",
    );
    const paths = result.files.map((f) => f.relativePath);
    expect(paths).toContain("engine/cred-proxy.js");
    expect(paths).toContain("engine/cred-proxy-routes.json");
  });

  it("tool registry is unified — compiler uses same generators as tools/index", () => {
    const result = compile({ profile: "life-ops" }, TEST_USER, "/tmp/test");
    // The quote tool should have the proxy-first pattern from quote.ts
    const quoteTool = result.files.find((f) => f.relativePath === "workspace/quote");
    expect(quoteTool).toBeDefined();
    expect(quoteTool?.content).toContain("CRED_PROXY_URL");
    expect(quoteTool?.content).toContain("/yahoo");
  });

  it("includes allowlist with profile egress domains", () => {
    const result = compile({ profile: "life-ops" }, TEST_USER, "/tmp/test");
    const allowlist = result.files.find((f) => f.relativePath === "ops/firewall/allowlist.yaml");
    expect(allowlist).toBeDefined();
    expect(allowlist?.content).toContain("api.todoist.com");
    expect(allowlist?.content).toContain("api.tavily.com");
  });

  it("adds provider egress domains to allowlist", () => {
    const result = compile(
      { profile: "life-ops", providers: { email: "gmail" } },
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
        model: "ollama/qwen2.5:14b",
        modelContextWindow: 16384,
      },
      TEST_USER,
      "/tmp/test",
    );
    const openclaw = findFile(result.files, "openclaw.json");
    const parsed = JSON.parse(openclaw.content) as {
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
      { profile: "life-ops" },
      TEST_USER,
      "/tmp/test",
    );
    const openclaw = findFile(result.files, "openclaw.json");
    const parsed = JSON.parse(openclaw.content) as {
      models: { providers: { ollama: { models: unknown[] } } };
    };
    expect(parsed.models.providers.ollama.models).toEqual([]);
  });

  // ── LLM-maintained knowledge base (wiki pattern) ───────────────────────────

  it("AGENTS.md emits a Knowledge Bases section when wiki-<kb>-ingest skills are present", () => {
    // life-ops declares wiki-trading-ingest/query/review — should produce a trading KB section
    const result = compile({ profile: "life-ops" }, TEST_USER, "/tmp/test");
    const agents = findFile(result.files, "workspace/AGENTS.md");
    const content = agents.content;
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
    const result = compile({ profile: "life-ops" }, TEST_USER, "/tmp/test");
    const bootstrap = findFile(result.files, "workspace/BOOTSTRAP.md");
    expect(bootstrap.content).toContain("state/wiki-context.md");
    expect(bootstrap.content).not.toContain("workspace/state/wiki-context.md");
    expect(bootstrap.content).toContain("`trading`");
  });

  it("cron/jobs.json does NOT auto-schedule event-driven wiki-*-ingest/query skills", () => {
    const result = compile({ profile: "life-ops" }, TEST_USER, "/tmp/test");
    const cron = findFile(result.files, "cron/jobs.json");
    const parsed = JSON.parse(cron.content) as { jobs: Array<{ id: string }> };
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
    const result = compile({ profile: "life-ops" }, TEST_USER, "/tmp/test");
    const cron = findFile(result.files, "cron/jobs.json");
    const parsed = JSON.parse(cron.content) as { jobs: Array<{ id: string; payload: { message: string } }> };
    const refresh = parsed.jobs.find((j) => j.id === "wiki-context-refresh");
    if (!refresh) throw new Error("wiki-context-refresh cron job missing");
    expect(refresh.payload.message).toContain("llm-wiki context");
    expect(refresh.payload.message).toContain("--path knowledge/trading");
    expect(refresh.payload.message).toContain("state/wiki-context.md");
    expect(refresh.payload.message).not.toContain("workspace/knowledge/trading");
    expect(refresh.payload.message).not.toContain("workspace/state/wiki-context.md");
  });

  it("applies modelFallbacks override", () => {
    const result = compile(
      {
        profile: "life-ops",
        model: "ollama/qwen2.5:14b",
        modelFallbacks: [`ollama/${OLLAMA_DEFAULT_MODEL}`],
      },
      TEST_USER,
      "/tmp/test",
    );
    const openclaw = findFile(result.files, "openclaw.json");
    const parsed = JSON.parse(openclaw.content) as {
      agents: { defaults: { model: { primary: string; fallbacks: string[] } } };
    };
    expect(parsed.agents.defaults.model.fallbacks).toEqual([`ollama/${OLLAMA_DEFAULT_MODEL}`]);
  });

  // ── Gateway token persistence ──────────────────────────────────────────
  //
  // The prior implementation called randomBytes on every compile, which meant
  // every `clawhq apply` rotated OPENCLAW_GATEWAY_TOKEN and orphaned every
  // open session. The token is now reused when the deployment already has
  // a real value on disk.

  function extractToken(envContent: string): string | undefined {
    const line = envContent.split("\n").find((l) => l.startsWith("OPENCLAW_GATEWAY_TOKEN="));
    return line?.slice("OPENCLAW_GATEWAY_TOKEN=".length);
  }

  it("reuses an existing OPENCLAW_GATEWAY_TOKEN across compiles", () => {
    // Simulate the existing deployment's .env after a prior init.
    const existingEnv = { OPENCLAW_GATEWAY_TOKEN: "real-existing-token-0123456789abcdef" };

    const first = compile(
      { profile: "life-ops" },
      TEST_USER,
      "/tmp/test",
      undefined,
      existingEnv,
    );
    const second = compile(
      { profile: "life-ops" },
      TEST_USER,
      "/tmp/test",
      undefined,
      existingEnv,
    );

    const t1 = extractToken(findFile(first.files, ".env").content);
    const t2 = extractToken(findFile(second.files, ".env").content);

    expect(t1).toBe("real-existing-token-0123456789abcdef");
    expect(t2).toBe("real-existing-token-0123456789abcdef");
  });

  it("generates a fresh token when existingEnv is empty (first init)", () => {
    const result = compile({ profile: "life-ops" }, TEST_USER, "/tmp/test");
    const token = extractToken(findFile(result.files, ".env").content);
    expect(token).toBeDefined();
    expect(token?.length).toBeGreaterThan(16);
    expect(token).not.toBe("CHANGE_ME");
  });

  // ── Determinism (byte-equal output on identical inputs) ───────────────

  it("produces byte-identical artifacts on two compiles of the same input", () => {
    const config = {
      profile: "life-ops",
      providers: { email: "gmail", calendar: "google-cal" },
      channels: { telegram: { enabled: true } },
    } as const;
    const existingEnv = { OPENCLAW_GATEWAY_TOKEN: "stable-test-token" };

    const first = compile(config, TEST_USER, "/tmp/test", undefined, existingEnv);
    const second = compile(config, TEST_USER, "/tmp/test", undefined, existingEnv);

    // Same set of files in the same order.
    expect(first.files.map((f) => f.relativePath))
      .toEqual(second.files.map((f) => f.relativePath));

    // Every file's content is byte-equal. The compiler itself is what we're
    // verifying; the shell of the test does the fan-out per file so failures
    // point at the specific artifact that diverged.
    for (let i = 0; i < first.files.length; i++) {
      const a = first.files[i];
      const b = second.files[i];
      expect(b.content, `divergence in ${a.relativePath}`).toBe(a.content);
    }
  });

  it("generates a fresh token when existing value is the CHANGE_ME placeholder", () => {
    const existingEnv = { OPENCLAW_GATEWAY_TOKEN: "CHANGE_ME" };
    const result = compile(
      { profile: "life-ops" },
      TEST_USER,
      "/tmp/test",
      undefined,
      existingEnv,
    );
    const token = extractToken(findFile(result.files, ".env").content);
    expect(token).toBeDefined();
    expect(token).not.toBe("CHANGE_ME");
    expect(token).not.toBe("");
  });
});

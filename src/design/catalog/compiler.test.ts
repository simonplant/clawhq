import { describe, expect, it } from "vitest";

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
    expect(paths).toContain("engine/docker-compose.yml");
    expect(paths).toContain("cron/jobs.json");
    expect(paths).toContain("clawhq.yaml");
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

  it("includes docker-compose.yml with security hardening", () => {
    const result = compile({ profile: "life-ops", personality: "digital-assistant" }, TEST_USER, "/tmp/test");
    const compose = result.files.find((f) => f.relativePath === "engine/docker-compose.yml");
    expect(compose).toBeDefined();
    expect(compose?.content).toContain("cap_drop");
    expect(compose?.content).toContain("no-new-privileges");
  });

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
});

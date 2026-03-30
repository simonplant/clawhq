import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

import {
  BUILTIN_ROUTES,
  buildRoutesConfig,
  CRED_PROXY_DEFAULT_HOST,
  CRED_PROXY_DEFAULT_PORT,
  CRED_PROXY_SERVICE_NAME,
  filterRoutesForEnv,
  routesConfigPath,
  writeRoutesConfig,
} from "./proxy-routes.js";
import { generateProxyServerScript } from "./proxy-server.js";
import type { ProxyRoute, ProxyRoutesConfig } from "./proxy-types.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "clawhq-proxy-test-"));
  // Create engine subdirectory
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(testDir, "engine"), { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ── Built-in Routes ─────────────────────────────────────────────────────────

describe("BUILTIN_ROUTES", () => {
  it("includes tavily route with body-json-field auth", () => {
    const tavily = BUILTIN_ROUTES.find((r) => r.id === "tavily");
    expect(tavily).toBeDefined();
    expect(tavily?.pathPrefix).toBe("/tavily");
    expect(tavily?.upstream).toBe("https://api.tavily.com");
    expect(tavily?.auth.type).toBe("body-json-field");
    if (tavily?.auth.type === "body-json-field") {
      expect(tavily.auth.field).toBe("api_key");
      expect(tavily.auth.envVar).toBe("TAVILY_API_KEY");
    }
  });

  it("includes todoist route with header auth", () => {
    const todoist = BUILTIN_ROUTES.find((r) => r.id === "todoist");
    expect(todoist).toBeDefined();
    expect(todoist?.pathPrefix).toBe("/todoist");
    expect(todoist?.upstream).toContain("api.todoist.com");
    expect(todoist?.auth.type).toBe("header");
    if (todoist?.auth.type === "header") {
      expect(todoist.auth.header).toBe("Authorization");
      expect(todoist.auth.prefix).toBe("Bearer ");
      expect(todoist.auth.envVar).toBe("TODOIST_API_TOKEN");
    }
  });

  it("includes todoist-sync route", () => {
    const sync = BUILTIN_ROUTES.find((r) => r.id === "todoist-sync");
    expect(sync).toBeDefined();
    expect(sync?.pathPrefix).toBe("/todoist-sync");
    expect(sync?.upstream).toContain("sync/v9");
  });

  it("includes anthropic route with x-api-key header", () => {
    const anthropic = BUILTIN_ROUTES.find((r) => r.id === "anthropic");
    expect(anthropic).toBeDefined();
    if (anthropic?.auth.type === "header") {
      expect(anthropic.auth.header).toBe("x-api-key");
      expect(anthropic.auth.envVar).toBe("ANTHROPIC_API_KEY");
    }
  });

  it("includes openai route with Bearer auth", () => {
    const openai = BUILTIN_ROUTES.find((r) => r.id === "openai");
    expect(openai).toBeDefined();
    if (openai?.auth.type === "header") {
      expect(openai.auth.header).toBe("Authorization");
      expect(openai.auth.prefix).toBe("Bearer ");
    }
  });

  it("has unique route IDs", () => {
    const ids = BUILTIN_ROUTES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has unique path prefixes", () => {
    const prefixes = BUILTIN_ROUTES.map((r) => r.pathPrefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});

// ── Route Config Building ───────────────────────────────────────────────────

describe("buildRoutesConfig", () => {
  it("builds config with default port and host", () => {
    const config = buildRoutesConfig(BUILTIN_ROUTES);
    expect(config.host).toBe(CRED_PROXY_DEFAULT_HOST);
    expect(config.port).toBe(CRED_PROXY_DEFAULT_PORT);
    expect(config.routes).toEqual(BUILTIN_ROUTES);
  });

  it("allows custom port", () => {
    const config = buildRoutesConfig(BUILTIN_ROUTES, 8080);
    expect(config.port).toBe(8080);
  });
});

// ── Route Filtering ─────────────────────────────────────────────────────────

describe("filterRoutesForEnv", () => {
  it("filters to only routes with configured env vars", () => {
    const env = { TAVILY_API_KEY: "test-key" };
    const filtered = filterRoutesForEnv(BUILTIN_ROUTES, env);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("tavily");
  });

  it("returns empty array when no env vars match", () => {
    const filtered = filterRoutesForEnv(BUILTIN_ROUTES, {});
    expect(filtered).toHaveLength(0);
  });

  it("returns multiple routes when multiple env vars set", () => {
    const env = {
      TAVILY_API_KEY: "key1",
      TODOIST_API_TOKEN: "token1",
      ANTHROPIC_API_KEY: "key2",
    };
    const filtered = filterRoutesForEnv(BUILTIN_ROUTES, env);
    // Todoist and todoist-sync share the same env var
    expect(filtered.length).toBe(4);
  });
});

// ── Routes File I/O ─────────────────────────────────────────────────────────

describe("writeRoutesConfig", () => {
  it("writes routes.json to deploy dir", async () => {
    const config = buildRoutesConfig(BUILTIN_ROUTES);
    const filePath = await writeRoutesConfig(testDir, config);
    expect(filePath).toBe(routesConfigPath(testDir));

    const content = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(content) as ProxyRoutesConfig;
    expect(parsed.routes).toHaveLength(BUILTIN_ROUTES.length);
    expect(parsed.port).toBe(CRED_PROXY_DEFAULT_PORT);
  });
});

describe("routesConfigPath", () => {
  it("returns path under engine directory", () => {
    const path = routesConfigPath("/home/user/.clawhq");
    expect(path).toBe("/home/user/.clawhq/engine/cred-proxy-routes.json");
  });
});

// ── Service Name ────────────────────────────────────────────────────────────

describe("CRED_PROXY_SERVICE_NAME", () => {
  it("is 'cred-proxy'", () => {
    expect(CRED_PROXY_SERVICE_NAME).toBe("cred-proxy");
  });
});

// ── Proxy Server Script ─────────────────────────────────────────────────────

describe("generateProxyServerScript", () => {
  it("generates a valid Node.js script with shebang", () => {
    const script = generateProxyServerScript();
    expect(script).toMatch(/^#!\/usr\/bin\/env node/);
  });

  it("includes health endpoint handler", () => {
    const script = generateProxyServerScript();
    expect(script).toContain("/health");
    expect(script).toContain("handleHealth");
  });

  it("includes route matching", () => {
    const script = generateProxyServerScript();
    expect(script).toContain("matchRoute");
    expect(script).toContain("pathPrefix");
  });

  it("includes credential injection for header auth", () => {
    const script = generateProxyServerScript();
    expect(script).toContain('"header"');
    expect(script).toContain("auth.header");
    expect(script).toContain("auth.prefix");
  });

  it("includes credential injection for body-json-field auth", () => {
    const script = generateProxyServerScript();
    expect(script).toContain('"body-json-field"');
    expect(script).toContain("auth.field");
  });

  it("includes audit logging", () => {
    const script = generateProxyServerScript();
    expect(script).toContain("auditLog");
    expect(script).toContain("proxy-audit.jsonl");
  });

  it("reads routes from CRED_PROXY_ROUTES env var", () => {
    const script = generateProxyServerScript();
    expect(script).toContain("CRED_PROXY_ROUTES");
  });

  it("includes graceful shutdown handlers", () => {
    const script = generateProxyServerScript();
    expect(script).toContain("SIGTERM");
    expect(script).toContain("SIGINT");
    expect(script).toContain("server.close");
  });

  it("has body size limit for safety", () => {
    const script = generateProxyServerScript();
    expect(script).toContain("MAX_BODY_BYTES");
  });

  it("removes hop-by-hop headers", () => {
    const script = generateProxyServerScript();
    expect(script).toContain("connection");
    expect(script).toContain("transfer-encoding");
  });

  it("tracks whether credentials were injected in audit log", () => {
    const script = generateProxyServerScript();
    expect(script).toContain("credInjected");
  });
});

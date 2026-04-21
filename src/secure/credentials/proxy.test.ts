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
import type { ProxyRoutesConfig } from "./proxy-types.js";

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
      expect(todoist.auth.envVar).toBe("TODOIST_API_KEY");
    }
  });

  it("does not include deprecated todoist-sync route", () => {
    const sync = BUILTIN_ROUTES.find((r) => r.id === "todoist-sync");
    expect(sync).toBeUndefined();
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

  it("includes yahoo route with no-auth (public API)", () => {
    const yahoo = BUILTIN_ROUTES.find((r) => r.id === "yahoo");
    expect(yahoo).toBeDefined();
    expect(yahoo?.pathPrefix).toBe("/yahoo");
    expect(yahoo?.upstream).toContain("finance.yahoo.com");
    expect(yahoo?.auth.type).toBe("none");
  });

  it("includes caldav route with basic auth", () => {
    const caldav = BUILTIN_ROUTES.find((r) => r.id === "caldav");
    expect(caldav).toBeDefined();
    expect(caldav?.pathPrefix).toBe("/caldav");
    expect(caldav?.auth.type).toBe("basic");
    if (caldav?.auth.type === "basic") {
      expect(caldav.auth.userEnvVar).toBe("CALDAV_USER");
      expect(caldav.auth.passEnvVar).toBe("CALDAV_PASS");
    }
  });

  it("includes tradier route with bearer auth and env-resolved upstream", () => {
    const tradier = BUILTIN_ROUTES.find((r) => r.id === "tradier");
    expect(tradier).toBeDefined();
    expect(tradier?.pathPrefix).toBe("/tradier");
    // Upstream is an env-var placeholder — runtime picks sandbox vs live
    // based on TRADIER_UPSTREAM in .env. Paper: sandbox.tradier.com,
    // live: api.tradier.com.
    expect(tradier?.upstream).toBe("env:TRADIER_UPSTREAM");
    expect(tradier?.auth.type).toBe("header");
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
  // "none" auth routes (e.g. yahoo) always pass filtering
  const alwaysIncluded = BUILTIN_ROUTES.filter((r) => r.auth.type === "none").length;

  it("filters to only routes with configured env vars (plus always-on routes)", () => {
    const env = { TAVILY_API_KEY: "test-key" };
    const filtered = filterRoutesForEnv(BUILTIN_ROUTES, env);
    expect(filtered).toHaveLength(1 + alwaysIncluded);
    expect(filtered.map((r) => r.id)).toContain("tavily");
  });

  it("returns only always-on routes when no env vars match", () => {
    const filtered = filterRoutesForEnv(BUILTIN_ROUTES, {});
    expect(filtered).toHaveLength(alwaysIncluded);
  });

  it("returns multiple routes when multiple env vars set", () => {
    const env = {
      TAVILY_API_KEY: "key1",
      TODOIST_API_KEY: "token1",
      ANTHROPIC_API_KEY: "key2",
    };
    const filtered = filterRoutesForEnv(BUILTIN_ROUTES, env);
    // tavily + todoist + anthropic, plus always-on routes
    expect(filtered.length).toBe(3 + alwaysIncluded);
  });

  it("includes basic auth routes when user env var is set", () => {
    const env = { CALDAV_USER: "user@example.com" };
    const filtered = filterRoutesForEnv(BUILTIN_ROUTES, env);
    expect(filtered.map((r) => r.id)).toContain("caldav");
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

  it("includes credential injection for basic auth", () => {
    const script = generateProxyServerScript();
    expect(script).toContain('"basic"');
    expect(script).toContain("auth.userEnvVar");
    expect(script).toContain("auth.passEnvVar");
    expect(script).toContain("Basic ");
  });

  it("includes passthrough for no-auth routes", () => {
    const script = generateProxyServerScript();
    expect(script).toContain('"none"');
  });

  it("resolves env: upstream references at startup", () => {
    const script = generateProxyServerScript();
    expect(script).toContain('env:');
    expect(script).toContain('.slice(4)');
  });

  it("sorts routes by prefix length for greedy matching", () => {
    const script = generateProxyServerScript();
    expect(script).toContain("sort");
    expect(script).toContain("pathPrefix.length");
  });
});

// ── Dynamic Upstream Routes ──────────────────────────────────────────────────

describe("dynamic upstream routes", () => {
  it("caldav route uses env:CALDAV_URL for dynamic upstream", () => {
    const caldav = BUILTIN_ROUTES.find((r) => r.id === "caldav");
    expect(caldav?.upstream).toBe("env:CALDAV_URL");
  });

  it("ha route uses env:HA_URL for dynamic upstream", () => {
    const ha = BUILTIN_ROUTES.find((r) => r.id === "ha");
    expect(ha?.upstream).toBe("env:HA_URL");
  });

  it("static routes have regular https:// upstreams", () => {
    const tavily = BUILTIN_ROUTES.find((r) => r.id === "tavily");
    expect(tavily?.upstream).toMatch(/^https:\/\//);
  });
});

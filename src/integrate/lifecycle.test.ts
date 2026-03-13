import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseEnv } from "../security/secrets/env.js";

import {
  addIntegration,
  checkCronDependencies,
  cleanIdentityReferences,
  formatIntegrationList,
  getConfiguredEgressDomains,
  listIntegrations,
  loadRegistry,
  removeIntegration,
  saveRegistry,
  swapIntegration,
} from "./lifecycle.js";
import type { IntegrateContext } from "./lifecycle.js";
import { IntegrateError } from "./types.js";

function makeCtx(tmpDir: string): IntegrateContext {
  return {
    openclawHome: join(tmpDir, "openclaw"),
    clawhqDir: join(tmpDir, "clawhq"),
  };
}

describe("loadRegistry / saveRegistry", () => {
  let tmpDir: string;
  let ctx: IntegrateContext;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-integrate-reg-${Date.now()}`);
    ctx = makeCtx(tmpDir);
    await mkdir(ctx.clawhqDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty registry when file does not exist", async () => {
    const reg = await loadRegistry(ctx);
    expect(reg.integrations).toEqual([]);
  });

  it("round-trips registry data", async () => {
    const registry = {
      integrations: [
        {
          category: "email",
          provider: "imap",
          envVar: "EMAIL_PASSWORD",
          addedAt: "2026-03-13T00:00:00Z",
          lastCheckedAt: null,
        },
      ],
    };
    await saveRegistry(ctx, registry);
    const loaded = await loadRegistry(ctx);
    expect(loaded).toEqual(registry);
  });
});

describe("addIntegration", () => {
  let tmpDir: string;
  let ctx: IntegrateContext;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-integrate-add-${Date.now()}`);
    ctx = makeCtx(tmpDir);
    await mkdir(ctx.openclawHome, { recursive: true });
    await mkdir(ctx.clawhqDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("adds integration and writes credential to .env", async () => {
    const result = await addIntegration(ctx, "email", "imap", "my-password", false);

    expect(result.integration.category).toBe("email");
    expect(result.integration.provider).toBe("imap");
    expect(result.integration.envVar).toBe("EMAIL_PASSWORD");

    // Check .env
    const envContent = await readFile(join(ctx.openclawHome, ".env"), "utf-8");
    const env = parseEnv(envContent);
    const entry = env.entries.find((e) => e.key === "EMAIL_PASSWORD");
    expect(entry?.value).toBe("my-password");

    // Check registry
    const reg = await loadRegistry(ctx);
    expect(reg.integrations).toHaveLength(1);
    expect(reg.integrations[0].category).toBe("email");
  });

  it("reports tools installed", async () => {
    const result = await addIntegration(ctx, "email", "imap", "pass", false);
    expect(result.toolsInstalled).toEqual(["email"]);
    expect(result.requiresRebuild).toBe(true); // email needs himalaya
  });

  it("reports egress domains for telegram", async () => {
    const result = await addIntegration(ctx, "messaging", "telegram", "token", false);
    expect(result.egressDomainsAdded).toContain("api.telegram.org");
  });

  it("throws on unknown category", async () => {
    await expect(
      addIntegration(ctx, "unknown", "foo", "bar", false),
    ).rejects.toThrow(IntegrateError);
  });

  it("throws on unknown provider", async () => {
    await expect(
      addIntegration(ctx, "email", "outlook", "bar", false),
    ).rejects.toThrow(IntegrateError);
  });

  it("throws on duplicate category", async () => {
    await addIntegration(ctx, "email", "imap", "pass", false);
    await expect(
      addIntegration(ctx, "email", "imap", "pass2", false),
    ).rejects.toThrow(IntegrateError);
  });

  it("updates TOOLS.md when it exists", async () => {
    const wsDir = join(ctx.openclawHome, "workspace");
    await mkdir(wsDir, { recursive: true });
    await writeFile(join(wsDir, "TOOLS.md"), "# TOOLS.md — Agent Toolbelt\n\n## Core Tools\n");

    await addIntegration(ctx, "email", "imap", "pass", false);

    const toolsMd = await readFile(join(wsDir, "TOOLS.md"), "utf-8");
    expect(toolsMd).toContain("email");
    expect(toolsMd).toContain("## Integrations");
  });

  it("appends to existing .env without overwriting", async () => {
    const envPath = join(ctx.openclawHome, ".env");
    await writeFile(envPath, "EXISTING_VAR=keep\n");

    await addIntegration(ctx, "email", "imap", "pass", false);

    const envContent = await readFile(envPath, "utf-8");
    expect(envContent).toContain("EXISTING_VAR=keep");
    expect(envContent).toContain("EMAIL_PASSWORD=pass");
  });
});

describe("removeIntegration", () => {
  let tmpDir: string;
  let ctx: IntegrateContext;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-integrate-remove-${Date.now()}`);
    ctx = makeCtx(tmpDir);
    await mkdir(ctx.openclawHome, { recursive: true });
    await mkdir(ctx.clawhqDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("removes integration and cleans .env", async () => {
    // Setup: add first
    await addIntegration(ctx, "research", "tavily", "key123", false);

    const result = await removeIntegration(ctx, "research");

    expect(result.category).toBe("research");
    expect(result.provider).toBe("tavily");
    expect(result.envVarsCleaned).toContain("TAVILY_API_KEY");
    expect(result.toolsRemoved).toContain("tavily");
    expect(result.egressDomainsRemoved).toContain("api.tavily.com");

    // Registry should be empty
    const reg = await loadRegistry(ctx);
    expect(reg.integrations).toHaveLength(0);

    // .env should not have the key
    const envContent = await readFile(join(ctx.openclawHome, ".env"), "utf-8");
    expect(envContent).not.toContain("TAVILY_API_KEY");
  });

  it("throws when category not configured", async () => {
    await expect(
      removeIntegration(ctx, "email"),
    ).rejects.toThrow(IntegrateError);
  });
});

describe("swapIntegration", () => {
  let tmpDir: string;
  let ctx: IntegrateContext;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-integrate-swap-${Date.now()}`);
    ctx = makeCtx(tmpDir);
    await mkdir(ctx.openclawHome, { recursive: true });
    await mkdir(ctx.clawhqDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("swaps provider within category", async () => {
    // Add caldav first
    await addIntegration(ctx, "calendar", "caldav", "old-pass", false);

    const result = await swapIntegration(ctx, "calendar", "icloud", "new-pass", false);

    expect(result.oldProvider).toBe("caldav");
    expect(result.newProvider).toBe("icloud");
    expect(result.envVarsCleaned).toContain("CALDAV_PASSWORD");
    expect(result.envVarsAdded).toContain("ICLOUD_APP_PASSWORD");

    // Registry should show new provider
    const reg = await loadRegistry(ctx);
    expect(reg.integrations).toHaveLength(1);
    expect(reg.integrations[0].provider).toBe("icloud");

    // .env should have new key, not old
    const envContent = await readFile(join(ctx.openclawHome, ".env"), "utf-8");
    expect(envContent).not.toContain("CALDAV_PASSWORD");
    expect(envContent).toContain("ICLOUD_APP_PASSWORD=new-pass");
  });

  it("throws when no integration exists for category", async () => {
    await expect(
      swapIntegration(ctx, "calendar", "icloud", "pass", false),
    ).rejects.toThrow(IntegrateError);
  });

  it("throws when swapping to same provider", async () => {
    await addIntegration(ctx, "calendar", "caldav", "pass", false);

    await expect(
      swapIntegration(ctx, "calendar", "caldav", "pass", false),
    ).rejects.toThrow(IntegrateError);
  });

  it("throws for unknown provider", async () => {
    await addIntegration(ctx, "calendar", "caldav", "pass", false);

    await expect(
      swapIntegration(ctx, "calendar", "outlook-cal", "pass", false),
    ).rejects.toThrow(IntegrateError);
  });

  it("reports egress domain changes", async () => {
    await addIntegration(ctx, "calendar", "caldav", "pass", false);
    const result = await swapIntegration(ctx, "calendar", "google-calendar", "token", false);

    // CalDAV has no egress domains, Google Calendar has some
    expect(result.egressDomainsRemoved).toEqual([]);
    expect(result.egressDomainsAdded).toContain("www.googleapis.com");
  });
});

describe("listIntegrations", () => {
  let tmpDir: string;
  let ctx: IntegrateContext;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-integrate-list-${Date.now()}`);
    ctx = makeCtx(tmpDir);
    await mkdir(ctx.openclawHome, { recursive: true });
    await mkdir(ctx.clawhqDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty list when no integrations configured", async () => {
    const entries = await listIntegrations(ctx);
    expect(entries).toEqual([]);
  });

  it("returns configured integrations with status", async () => {
    await addIntegration(ctx, "email", "imap", "pass", false);
    await addIntegration(ctx, "research", "tavily", "key", false);

    const entries = await listIntegrations(ctx);
    expect(entries).toHaveLength(2);
    expect(entries[0].category).toBe("email");
    expect(entries[0].status).toBe("configured");
    expect(entries[1].category).toBe("research");
  });

  it("reports missing-credential when .env value is gone", async () => {
    await addIntegration(ctx, "email", "imap", "pass", false);

    // Manually remove from .env
    await writeFile(join(ctx.openclawHome, ".env"), "");

    const entries = await listIntegrations(ctx);
    expect(entries[0].status).toBe("missing-credential");
    expect(entries[0].credentialHealth).toBe("missing");
  });
});

describe("formatIntegrationList", () => {
  it("shows empty message when no integrations", () => {
    const output = formatIntegrationList([]);
    expect(output).toContain("No integrations configured");
  });

  it("formats entries as table", () => {
    const output = formatIntegrationList([
      {
        category: "email",
        provider: "imap",
        status: "configured",
        credentialHealth: "unchecked",
        addedAt: "2026-03-13T00:00:00Z",
        lastUsed: null,
      },
    ]);
    expect(output).toContain("email");
    expect(output).toContain("imap");
    expect(output).toContain("CATEGORY");
  });
});

describe("getConfiguredEgressDomains", () => {
  let tmpDir: string;
  let ctx: IntegrateContext;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-integrate-egress-${Date.now()}`);
    ctx = makeCtx(tmpDir);
    await mkdir(ctx.openclawHome, { recursive: true });
    await mkdir(ctx.clawhqDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty when no integrations", async () => {
    const domains = await getConfiguredEgressDomains(ctx);
    expect(domains).toEqual([]);
  });

  it("returns egress domains for configured integrations", async () => {
    await addIntegration(ctx, "messaging", "telegram", "token", false);
    await addIntegration(ctx, "research", "tavily", "key", false);

    const domains = await getConfiguredEgressDomains(ctx);
    expect(domains).toContain("api.telegram.org");
    expect(domains).toContain("api.tavily.com");
  });
});

describe("checkCronDependencies", () => {
  let tmpDir: string;
  let ctx: IntegrateContext;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-integrate-cron-${Date.now()}`);
    ctx = makeCtx(tmpDir);
    await mkdir(ctx.openclawHome, { recursive: true });
    await mkdir(ctx.clawhqDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty when no cron jobs exist", async () => {
    const result = await checkCronDependencies(ctx, "email");
    expect(result.dependentJobs).toEqual([]);
    expect(result.hasActiveDependencies).toBe(false);
  });

  it("detects cron jobs that reference category tools", async () => {
    const cronDir = join(ctx.openclawHome, "cron");
    await mkdir(cronDir, { recursive: true });
    await writeFile(
      join(cronDir, "jobs.json"),
      JSON.stringify([
        { id: "heartbeat", task: "Run email inbox check and todoist-sync poll", enabled: true },
        { id: "backup", task: "Run backup routine", enabled: true },
      ]),
    );

    const result = await checkCronDependencies(ctx, "email");
    expect(result.dependentJobs).toHaveLength(1);
    expect(result.dependentJobs[0].id).toBe("heartbeat");
    expect(result.hasActiveDependencies).toBe(true);
  });

  it("detects disabled dependencies without flagging as active", async () => {
    const cronDir = join(ctx.openclawHome, "cron");
    await mkdir(cronDir, { recursive: true });
    await writeFile(
      join(cronDir, "jobs.json"),
      JSON.stringify([
        { id: "sync", task: "Run todoist-sync poll", enabled: false },
      ]),
    );

    const result = await checkCronDependencies(ctx, "tasks");
    expect(result.dependentJobs).toHaveLength(1);
    expect(result.hasActiveDependencies).toBe(false);
  });

  it("handles jobs wrapped in object with jobs key", async () => {
    const cronDir = join(ctx.openclawHome, "cron");
    await mkdir(cronDir, { recursive: true });
    await writeFile(
      join(cronDir, "jobs.json"),
      JSON.stringify({ jobs: [
        { id: "research", task: "Use tavily to search for news", enabled: true },
      ]}),
    );

    const result = await checkCronDependencies(ctx, "research");
    expect(result.dependentJobs).toHaveLength(1);
    expect(result.hasActiveDependencies).toBe(true);
  });
});

describe("cleanIdentityReferences", () => {
  let tmpDir: string;
  let ctx: IntegrateContext;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-integrate-identity-${Date.now()}`);
    ctx = makeCtx(tmpDir);
    await mkdir(ctx.openclawHome, { recursive: true });
    await mkdir(ctx.clawhqDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty when no identity files exist", async () => {
    const updated = await cleanIdentityReferences(ctx, "email");
    expect(updated).toEqual([]);
  });

  it("removes marker-bounded section from identity files", async () => {
    const wsDir = join(ctx.openclawHome, "workspace");
    await mkdir(wsDir, { recursive: true });

    const content = [
      "# HEARTBEAT.md",
      "",
      "## Phase 1: RECON",
      "",
      "<!-- clawhq:email -->",
      "### Email",
      "- email inbox",
      "<!-- /clawhq:email -->",
      "",
      "## Phase 2: ACT",
    ].join("\n");

    await writeFile(join(wsDir, "HEARTBEAT.md"), content);

    const updated = await cleanIdentityReferences(ctx, "email");
    expect(updated).toContain("HEARTBEAT.md");

    const result = await readFile(join(wsDir, "HEARTBEAT.md"), "utf-8");
    expect(result).not.toContain("### Email");
    expect(result).not.toContain("email inbox");
    expect(result).toContain("## Phase 1: RECON");
    expect(result).toContain("## Phase 2: ACT");
  });

  it("does not modify files without markers", async () => {
    const wsDir = join(ctx.openclawHome, "workspace");
    await mkdir(wsDir, { recursive: true });

    const content = "# AGENTS.md\n\n## Session Startup\n";
    await writeFile(join(wsDir, "AGENTS.md"), content);

    const updated = await cleanIdentityReferences(ctx, "email");
    expect(updated).toEqual([]);

    const result = await readFile(join(wsDir, "AGENTS.md"), "utf-8");
    expect(result).toBe(content);
  });
});

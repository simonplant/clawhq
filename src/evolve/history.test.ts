import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { saveRegistry as saveSkillRegistry } from "./skills/registry.js";
import type { InstalledSkill, SkillContext } from "./skills/types.js";
import { loadRegistry as loadToolRegistry, saveRegistry as saveToolRegistry } from "./tools/registry.js";

import {
  type EvolveContext,
  EvolveError,
  formatHistory,
  getHistory,
  loadHistory,
  recordChange,
  rollbackChange,
  saveHistory,
} from "./history.js";

function makeCtx(tmpDir: string): EvolveContext {
  return {
    openclawHome: join(tmpDir, "openclaw"),
    clawhqDir: join(tmpDir, "clawhq"),
  };
}

function makeSkill(name: string, overrides: Partial<InstalledSkill> = {}): InstalledSkill {
  return {
    name,
    version: "1.0.0",
    source: "local",
    sourceUri: "/path/to/skill",
    status: "active",
    installedAt: "2026-03-13T00:00:00Z",
    lastUsed: null,
    requiresContainerDeps: false,
    rollbackSnapshotId: null,
    ...overrides,
  };
}

describe("evolve history — persistence", () => {
  let tmpDir: string;
  let ctx: EvolveContext;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-evolve-${Date.now()}`);
    ctx = makeCtx(tmpDir);
    await mkdir(ctx.clawhqDir, { recursive: true });
    await mkdir(join(ctx.openclawHome, "workspace", "skills"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty history when no file exists", async () => {
    const history = await loadHistory(ctx);
    expect(history.changes).toEqual([]);
  });

  it("persists and loads history", async () => {
    const history = { changes: [
      {
        id: "evolve-1",
        timestamp: "2026-03-13T00:00:00Z",
        changeType: "skill_install" as const,
        target: "test-skill",
        previousState: "not installed",
        newState: "test-skill@1.0.0",
        rollbackSnapshotId: null,
        rollbackExpiresAt: null,
        requiresRebuild: false,
      },
    ] };

    await saveHistory(ctx, history);
    const loaded = await loadHistory(ctx);

    expect(loaded.changes).toHaveLength(1);
    expect(loaded.changes[0].target).toBe("test-skill");
  });
});

describe("recordChange", () => {
  let tmpDir: string;
  let ctx: EvolveContext;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-record-${Date.now()}`);
    ctx = makeCtx(tmpDir);
    await mkdir(ctx.clawhqDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("records a change with auto-generated ID and timestamp", async () => {
    const change = await recordChange(ctx, {
      changeType: "skill_install",
      target: "morning-brief",
      previousState: "not installed",
      newState: "morning-brief@1.0.0",
      rollbackSnapshotId: null,
      requiresRebuild: false,
    });

    expect(change.id).toMatch(/^evolve-\d+$/);
    expect(change.timestamp).toBeTruthy();
    expect(change.changeType).toBe("skill_install");
    expect(change.target).toBe("morning-brief");
    expect(change.rollbackExpiresAt).toBeNull();
  });

  it("sets expiration when rollback snapshot is provided", async () => {
    const change = await recordChange(ctx, {
      changeType: "skill_remove",
      target: "old-skill",
      previousState: "old-skill@1.0.0",
      newState: "removed",
      rollbackSnapshotId: "snap-old-skill-123",
      requiresRebuild: false,
    });

    expect(change.rollbackExpiresAt).toBeTruthy();
    const expires = new Date(change.rollbackExpiresAt ?? "");
    const now = new Date();
    const diffDays = (expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(29);
    expect(diffDays).toBeLessThanOrEqual(30);
  });

  it("appends multiple changes in order", async () => {
    await recordChange(ctx, {
      changeType: "tool_install",
      target: "ffmpeg",
      previousState: "not installed",
      newState: "installed",
      rollbackSnapshotId: "ffmpeg",
      requiresRebuild: true,
    });
    await recordChange(ctx, {
      changeType: "skill_install",
      target: "slack-poster",
      previousState: "not installed",
      newState: "slack-poster@1.0.0",
      rollbackSnapshotId: null,
      requiresRebuild: false,
    });

    const history = await loadHistory(ctx);
    expect(history.changes).toHaveLength(2);
    expect(history.changes[0].target).toBe("ffmpeg");
    expect(history.changes[1].target).toBe("slack-poster");
  });
});

describe("getHistory", () => {
  it("returns entries in reverse chronological order", () => {
    const history = {
      changes: [
        {
          id: "evolve-1",
          timestamp: "2026-03-01T00:00:00Z",
          changeType: "skill_install" as const,
          target: "first",
          previousState: "",
          newState: "",
          rollbackSnapshotId: null,
          rollbackExpiresAt: null,
          requiresRebuild: false,
        },
        {
          id: "evolve-2",
          timestamp: "2026-03-02T00:00:00Z",
          changeType: "tool_install" as const,
          target: "second",
          previousState: "",
          newState: "",
          rollbackSnapshotId: null,
          rollbackExpiresAt: null,
          requiresRebuild: false,
        },
      ],
    };

    const entries = getHistory(history);
    expect(entries[0].target).toBe("second");
    expect(entries[1].target).toBe("first");
  });

  it("marks snapshots as available when not expired", () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const history = {
      changes: [
        {
          id: "evolve-1",
          timestamp: "2026-03-01T00:00:00Z",
          changeType: "skill_remove" as const,
          target: "removed-skill",
          previousState: "",
          newState: "",
          rollbackSnapshotId: "snap-removed-123",
          rollbackExpiresAt: future,
          requiresRebuild: false,
        },
      ],
    };

    const entries = getHistory(history);
    expect(entries[0].rollbackStatus).toBe("available");
  });

  it("marks snapshots as expired when past expiration", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const history = {
      changes: [
        {
          id: "evolve-1",
          timestamp: "2026-01-01T00:00:00Z",
          changeType: "skill_remove" as const,
          target: "old-skill",
          previousState: "",
          newState: "",
          rollbackSnapshotId: "snap-old-123",
          rollbackExpiresAt: past,
          requiresRebuild: false,
        },
      ],
    };

    const entries = getHistory(history);
    expect(entries[0].rollbackStatus).toBe("expired");
  });

  it("marks changes without snapshots as unavailable", () => {
    const history = {
      changes: [
        {
          id: "evolve-1",
          timestamp: "2026-03-01T00:00:00Z",
          changeType: "skill_install" as const,
          target: "new-skill",
          previousState: "",
          newState: "",
          rollbackSnapshotId: null,
          rollbackExpiresAt: null,
          requiresRebuild: false,
        },
      ],
    };

    const entries = getHistory(history);
    expect(entries[0].rollbackStatus).toBe("unavailable");
  });
});

describe("rollbackChange", () => {
  let tmpDir: string;
  let ctx: EvolveContext;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-rollback-${Date.now()}`);
    ctx = makeCtx(tmpDir);
    await mkdir(ctx.clawhqDir, { recursive: true });
    await mkdir(join(ctx.openclawHome, "workspace", "skills"), { recursive: true });
    await mkdir(join(ctx.clawhqDir, "skills"), { recursive: true });
    await mkdir(join(ctx.clawhqDir, "tools"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("throws for non-existent change ID", async () => {
    await saveHistory(ctx, { changes: [] });

    await expect(rollbackChange(ctx, "evolve-nonexistent")).rejects.toThrow(EvolveError);
  });

  it("throws for expired rollback snapshot", async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    await saveHistory(ctx, {
      changes: [
        {
          id: "evolve-expired",
          timestamp: "2026-01-01T00:00:00Z",
          changeType: "skill_remove",
          target: "old-skill",
          previousState: "old-skill@1.0.0",
          newState: "removed",
          rollbackSnapshotId: "snap-old-123",
          rollbackExpiresAt: past,
          requiresRebuild: false,
        },
      ],
    });

    await expect(rollbackChange(ctx, "evolve-expired")).rejects.toThrow("expired");
  });

  it("throws for changes with no snapshot", async () => {
    await saveHistory(ctx, {
      changes: [
        {
          id: "evolve-no-snap",
          timestamp: "2026-03-13T00:00:00Z",
          changeType: "skill_install",
          target: "new-skill",
          previousState: "not installed",
          newState: "new-skill@1.0.0",
          rollbackSnapshotId: null,
          rollbackExpiresAt: null,
          requiresRebuild: false,
        },
      ],
    });

    await expect(rollbackChange(ctx, "evolve-no-snap")).rejects.toThrow("no rollback snapshot");
  });

  it("rolls back a tool_install by removing the tool", async () => {
    // Set up a tool that was installed
    const toolCtx = { openclawHome: ctx.openclawHome, clawhqDir: ctx.clawhqDir };
    await saveToolRegistry(toolCtx, {
      tools: [{ name: "himalaya", installedAt: "2026-03-13T00:00:00Z", explicit: true }],
    });

    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await saveHistory(ctx, {
      changes: [
        {
          id: "evolve-tool-install",
          timestamp: "2026-03-13T00:00:00Z",
          changeType: "tool_install",
          target: "himalaya",
          previousState: "not installed",
          newState: "installed",
          rollbackSnapshotId: "himalaya",
          rollbackExpiresAt: future,
          requiresRebuild: true,
        },
      ],
    });

    const result = await rollbackChange(ctx, "evolve-tool-install");

    expect(result.requiresRebuild).toBe(true);
    expect(result.change.target).toBe("himalaya");

    // Verify tool was removed from registry
    const toolReg = await loadToolRegistry(toolCtx);
    expect(toolReg.tools.find((t) => t.name === "himalaya")).toBeUndefined();
  });

  it("rolls back a tool_remove by re-installing the tool", async () => {
    // Tool is currently NOT in registry (was removed)
    const toolCtx = { openclawHome: ctx.openclawHome, clawhqDir: ctx.clawhqDir };
    await saveToolRegistry(toolCtx, { tools: [] });

    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await saveHistory(ctx, {
      changes: [
        {
          id: "evolve-tool-remove",
          timestamp: "2026-03-13T00:00:00Z",
          changeType: "tool_remove",
          target: "himalaya",
          previousState: "installed",
          newState: "removed",
          rollbackSnapshotId: "himalaya",
          rollbackExpiresAt: future,
          requiresRebuild: true,
        },
      ],
    });

    const result = await rollbackChange(ctx, "evolve-tool-remove");

    expect(result.requiresRebuild).toBe(true);

    // Verify tool was re-added to registry
    const toolReg = await loadToolRegistry(toolCtx);
    expect(toolReg.tools.find((t) => t.name === "himalaya")).toBeDefined();
  });

  it("rolls back a skill_remove using skill snapshot", async () => {
    // Set up: skill was removed, snapshot exists
    const skillCtx: SkillContext = { openclawHome: ctx.openclawHome, clawhqDir: ctx.clawhqDir };
    const skill = makeSkill("my-skill");

    // Create snapshot manually (simulating what removeSkillOp does)
    const { createSnapshot } = await import("./skills/snapshot.js");
    const skillDir = join(ctx.openclawHome, "workspace", "skills", "my-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: my-skill\n---\n# My Skill\n");
    const snapshotId = await createSnapshot(skillCtx, skill, skillDir);

    // Remove the skill files (simulating what happens after snapshot)
    await rm(skillDir, { recursive: true, force: true });

    // Remove from registry too
    await saveSkillRegistry(skillCtx, { skills: [] });

    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await saveHistory(ctx, {
      changes: [
        {
          id: "evolve-skill-remove",
          timestamp: "2026-03-13T00:00:00Z",
          changeType: "skill_remove",
          target: "my-skill",
          previousState: "my-skill@1.0.0",
          newState: "removed",
          rollbackSnapshotId: snapshotId,
          rollbackExpiresAt: future,
          requiresRebuild: false,
        },
      ],
    });

    const result = await rollbackChange(ctx, "evolve-skill-remove");

    expect(result.change.target).toBe("my-skill");

    // Verify skill files restored
    const content = await readFile(join(skillDir, "SKILL.md"), "utf-8");
    expect(content).toContain("my-skill");

    // Verify skill re-added to registry
    const { loadRegistry: loadSkillReg } = await import("./skills/registry.js");
    const skillReg = await loadSkillReg(skillCtx);
    expect(skillReg.skills.find((s) => s.name === "my-skill")).toBeDefined();
  });

  it("rolls back an integration_add by removing the integration", async () => {
    // Set up: integration was added, registry has it
    const intPath = join(ctx.clawhqDir, "integrations.json");
    await writeFile(intPath, JSON.stringify({
      integrations: [{
        category: "email",
        provider: "icloud",
        envVar: "ICLOUD_APP_PASSWORD",
        addedAt: "2026-03-13T00:00:00Z",
        lastCheckedAt: null,
      }],
    }));

    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await saveHistory(ctx, {
      changes: [
        {
          id: "evolve-int-add",
          timestamp: "2026-03-13T00:00:00Z",
          changeType: "integration_add",
          target: "email",
          previousState: "not configured",
          newState: "email/icloud",
          rollbackSnapshotId: JSON.stringify({
            action: "add",
            integration: {
              category: "email",
              provider: "icloud",
              envVar: "ICLOUD_APP_PASSWORD",
              addedAt: "2026-03-13T00:00:00Z",
              lastCheckedAt: null,
            },
          }),
          rollbackExpiresAt: future,
          requiresRebuild: false,
        },
      ],
    });

    const result = await rollbackChange(ctx, "evolve-int-add");

    expect(result.change.target).toBe("email");

    // Verify integration removed from registry
    const regContent = JSON.parse(await readFile(intPath, "utf-8"));
    expect(regContent.integrations).toHaveLength(0);
  });

  it("rolls back a provider_add by removing the provider", async () => {
    // Set up: provider was added, registry has it
    const providerPath = join(ctx.openclawHome, "providers.json");
    await writeFile(providerPath, JSON.stringify({
      providers: [{
        id: "openai",
        label: "OpenAI",
        category: "llm",
        envVar: "OPENAI_API_KEY",
        domains: ["api.openai.com"],
        status: "active",
        addedAt: "2026-03-13T00:00:00Z",
      }],
    }));

    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await saveHistory(ctx, {
      changes: [
        {
          id: "evolve-prov-add",
          timestamp: "2026-03-13T00:00:00Z",
          changeType: "provider_add",
          target: "openai",
          previousState: "not configured",
          newState: "OpenAI (openai)",
          rollbackSnapshotId: JSON.stringify({
            action: "add",
            provider: {
              id: "openai",
              label: "OpenAI",
              category: "llm",
              envVar: "OPENAI_API_KEY",
              domains: ["api.openai.com"],
              status: "active",
              addedAt: "2026-03-13T00:00:00Z",
            },
          }),
          rollbackExpiresAt: future,
          requiresRebuild: false,
        },
      ],
    });

    const result = await rollbackChange(ctx, "evolve-prov-add");

    expect(result.change.target).toBe("openai");
    expect(result.requiresRebuild).toBe(false);

    // Verify provider removed from registry
    const regContent = JSON.parse(await readFile(providerPath, "utf-8"));
    expect(regContent.providers).toHaveLength(0);
  });

  it("rolls back a provider_remove by restoring the provider", async () => {
    // Set up: provider was removed, registry is empty
    const providerPath = join(ctx.openclawHome, "providers.json");
    await writeFile(providerPath, JSON.stringify({ providers: [] }));

    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await saveHistory(ctx, {
      changes: [
        {
          id: "evolve-prov-remove",
          timestamp: "2026-03-13T00:00:00Z",
          changeType: "provider_remove",
          target: "anthropic",
          previousState: "Anthropic (anthropic)",
          newState: "removed",
          rollbackSnapshotId: JSON.stringify({
            action: "remove",
            provider: {
              id: "anthropic",
              label: "Anthropic",
              category: "llm",
              envVar: "ANTHROPIC_API_KEY",
              domains: ["api.anthropic.com"],
              status: "active",
              addedAt: "2026-03-13T00:00:00Z",
            },
          }),
          rollbackExpiresAt: future,
          requiresRebuild: false,
        },
      ],
    });

    const result = await rollbackChange(ctx, "evolve-prov-remove");

    expect(result.change.target).toBe("anthropic");

    // Verify provider restored to registry
    const regContent = JSON.parse(await readFile(providerPath, "utf-8"));
    expect(regContent.providers).toHaveLength(1);
    expect(regContent.providers[0].id).toBe("anthropic");
  });

  it("rolls back an identity_update by restoring previous file content", async () => {
    // Set up: identity file was updated
    const identityDir = join(ctx.openclawHome, "workspace");
    await mkdir(identityDir, { recursive: true });
    const identityFile = join(identityDir, "IDENTITY.md");
    await writeFile(identityFile, "# Updated identity\nNew content here.");

    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const originalContent = "# Original identity\nOld content here.";
    await saveHistory(ctx, {
      changes: [
        {
          id: "evolve-identity",
          timestamp: "2026-03-13T00:00:00Z",
          changeType: "identity_update",
          target: "IDENTITY.md",
          previousState: "previous version",
          newState: "updated version",
          rollbackSnapshotId: JSON.stringify({
            filePath: "workspace/IDENTITY.md",
            content: originalContent,
          }),
          rollbackExpiresAt: future,
          requiresRebuild: false,
        },
      ],
    });

    const result = await rollbackChange(ctx, "evolve-identity");

    expect(result.change.target).toBe("IDENTITY.md");
    expect(result.requiresRebuild).toBe(false);

    // Verify file content restored
    const content = await readFile(identityFile, "utf-8");
    expect(content).toBe(originalContent);
  });

  it("records rollback as a new change in history", async () => {
    // Set up tool rollback scenario
    const toolCtx = { openclawHome: ctx.openclawHome, clawhqDir: ctx.clawhqDir };
    await saveToolRegistry(toolCtx, {
      tools: [{ name: "himalaya", installedAt: "2026-03-13T00:00:00Z", explicit: true }],
    });

    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await saveHistory(ctx, {
      changes: [
        {
          id: "evolve-tool-install",
          timestamp: "2026-03-13T00:00:00Z",
          changeType: "tool_install",
          target: "himalaya",
          previousState: "not installed",
          newState: "installed",
          rollbackSnapshotId: "himalaya",
          rollbackExpiresAt: future,
          requiresRebuild: true,
        },
      ],
    });

    await rollbackChange(ctx, "evolve-tool-install");

    // History should now have 2 entries: original + rollback
    const history = await loadHistory(ctx);
    expect(history.changes).toHaveLength(2);
    expect(history.changes[1].newState).toContain("rolled back");
  });
});

describe("formatHistory", () => {
  it("returns message when no changes exist", () => {
    const output = formatHistory([]);
    expect(output).toContain("No evolve changes");
  });

  it("formats entries with columns", () => {
    const entries = [
      {
        id: "evolve-123",
        timestamp: "2026-03-13T12:00:00Z",
        changeType: "skill_install" as const,
        target: "morning-brief",
        previousState: "",
        newState: "",
        rollbackSnapshotId: null,
        rollbackExpiresAt: null,
        requiresRebuild: false,
        rollbackStatus: "unavailable" as const,
      },
      {
        id: "evolve-456",
        timestamp: "2026-03-13T13:00:00Z",
        changeType: "tool_install" as const,
        target: "ffmpeg",
        previousState: "",
        newState: "",
        rollbackSnapshotId: "ffmpeg",
        rollbackExpiresAt: "2026-04-12T13:00:00Z",
        requiresRebuild: true,
        rollbackStatus: "available" as const,
      },
    ];

    const output = formatHistory(entries);
    expect(output).toContain("evolve-123");
    expect(output).toContain("evolve-456");
    expect(output).toContain("Skill Install");
    expect(output).toContain("Tool Install");
    expect(output).toContain("AVAILABLE");
    expect(output).toContain("morning-brief");
    expect(output).toContain("ffmpeg");
  });
});

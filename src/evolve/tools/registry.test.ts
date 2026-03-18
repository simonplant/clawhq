import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addTool,
  findKnownTool,
  findTool,
  KNOWN_TOOLS,
  loadRegistry,
  removeTool,
  saveRegistry,
} from "./registry.js";
import type { InstalledTool, ToolContext, ToolRegistry } from "./types.js";

function makeTool(overrides: Partial<InstalledTool> = {}): InstalledTool {
  return {
    name: "test-tool",
    installedAt: "2026-03-13T00:00:00Z",
    explicit: true,
    ...overrides,
  };
}

describe("tool registry persistence", () => {
  let tmpDir: string;
  let ctx: ToolContext;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-tool-registry-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    ctx = {
      openclawHome: join(tmpDir, "openclaw"),
      clawhqDir: tmpDir,
    };
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty registry when file does not exist", async () => {
    const reg = await loadRegistry(ctx);
    expect(reg.tools).toEqual([]);
  });

  it("saves and loads registry", async () => {
    const tool = makeTool();
    const reg: ToolRegistry = { tools: [tool] };

    await saveRegistry(ctx, reg);
    const loaded = await loadRegistry(ctx);

    expect(loaded.tools).toHaveLength(1);
    expect(loaded.tools[0].name).toBe("test-tool");
  });

  it("persists as valid JSON", async () => {
    await saveRegistry(ctx, { tools: [makeTool()] });

    const raw = await readFile(join(tmpDir, "tools", "registry.json"), "utf-8");
    const parsed = JSON.parse(raw) as ToolRegistry;
    expect(parsed.tools).toHaveLength(1);
  });
});

describe("tool registry operations", () => {
  const base: ToolRegistry = {
    tools: [makeTool({ name: "alpha" }), makeTool({ name: "beta" })],
  };

  it("findTool returns matching tool", () => {
    expect(findTool(base, "alpha")?.name).toBe("alpha");
    expect(findTool(base, "beta")?.name).toBe("beta");
    expect(findTool(base, "gamma")).toBeUndefined();
  });

  it("addTool appends a new tool", () => {
    const updated = addTool(base, makeTool({ name: "gamma" }));
    expect(updated.tools).toHaveLength(3);
    expect(findTool(updated, "gamma")).toBeDefined();
  });

  it("removeTool filters out the named tool", () => {
    const updated = removeTool(base, "alpha");
    expect(updated.tools).toHaveLength(1);
    expect(findTool(updated, "alpha")).toBeUndefined();
    expect(findTool(updated, "beta")).toBeDefined();
  });
});

describe("known tools catalog", () => {
  it("contains the always-included tools", () => {
    const always = KNOWN_TOOLS.filter((t) => t.alwaysIncluded);
    const names = always.map((t) => t.name);
    expect(names).toContain("curl");
    expect(names).toContain("jq");
    expect(names).toContain("rg");
  });

  it("findKnownTool looks up by name", () => {
    expect(findKnownTool("jq")?.name).toBe("jq");
    expect(findKnownTool("himalaya")?.name).toBe("himalaya");
    expect(findKnownTool("nonexistent")).toBeUndefined();
  });

  it("every tool has required fields", () => {
    for (const tool of KNOWN_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.verifyCmd).toBeTruthy();
      expect(tool.tags.length).toBeGreaterThan(0);
    }
  });
});

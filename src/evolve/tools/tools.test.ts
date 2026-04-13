import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { formatToolList, formatToolListJson } from "./list.js";
import {
  loadToolManifest,
  removeEntry,
  saveToolManifest,
  upsertEntry,
} from "./manifest.js";
import { availableToolNames, TOOL_REGISTRY } from "./registry.js";
import type { ToolManifest, ToolManifestEntry } from "./types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

let testDir: string;
let deployDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "clawhq-tool-test-"));
  deployDir = join(testDir, "deploy");
  mkdirSync(join(deployDir, "workspace", "tools"), { recursive: true });
  writeFileSync(join(deployDir, "clawhq.yaml"), "version: test");
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ── Registry ────────────────────────────────────────────────────────────────

describe("TOOL_REGISTRY", () => {
  it("contains expected built-in tools", () => {
    const names = availableToolNames();
    expect(names).toContain("email");
    expect(names).toContain("calendar");
    expect(names).toContain("tasks");
    expect(names).toContain("backlog");
    expect(names).toContain("quote");
    expect(names).toContain("search");
  });

  it("every registered generator returns a non-empty string", () => {
    for (const [name, generator] of Object.entries(TOOL_REGISTRY)) {
      const content = generator();
      expect(content, `generator for "${name}" returned empty`).toBeTruthy();
      expect(typeof content).toBe("string");
    }
  });

  it("availableToolNames matches TOOL_REGISTRY keys", () => {
    expect(availableToolNames()).toEqual(Object.keys(TOOL_REGISTRY));
  });
});

// ── Manifest I/O ────────────────────────────────────────────────────────────

describe("manifest", () => {
  it("returns empty manifest when no file exists", async () => {
    const manifest = await loadToolManifest(deployDir);
    expect(manifest.version).toBe(1);
    expect(manifest.tools).toHaveLength(0);
  });

  it("round-trips save and load", async () => {
    const manifest: ToolManifest = {
      version: 1,
      tools: [
        { name: "email", source: "registry", installedAt: "2026-01-01T00:00:00Z" },
      ],
    };
    await saveToolManifest(deployDir, manifest);
    const loaded = await loadToolManifest(deployDir);
    expect(loaded.version).toBe(1);
    expect(loaded.tools).toHaveLength(1);
    expect(loaded.tools[0].name).toBe("email");
  });

  it("creates directories if missing during save", async () => {
    const freshDir = join(testDir, "fresh");
    const manifest: ToolManifest = { version: 1, tools: [] };
    await saveToolManifest(freshDir, manifest);
    expect(existsSync(join(freshDir, "workspace", "tools", ".tool-manifest.json"))).toBe(true);
  });

  it("returns empty manifest on corrupted JSON", async () => {
    writeFileSync(
      join(deployDir, "workspace", "tools", ".tool-manifest.json"),
      "not-json{{{",
    );
    const manifest = await loadToolManifest(deployDir);
    expect(manifest.version).toBe(1);
    expect(manifest.tools).toHaveLength(0);
  });

  it("throws on unsupported manifest version", async () => {
    writeFileSync(
      join(deployDir, "workspace", "tools", ".tool-manifest.json"),
      JSON.stringify({ version: 2, tools: [] }),
    );
    await expect(loadToolManifest(deployDir)).rejects.toThrow(
      /Unsupported tool manifest version 2 \(expected 1\)/,
    );
  });

  it("throws on missing version field", async () => {
    writeFileSync(
      join(deployDir, "workspace", "tools", ".tool-manifest.json"),
      JSON.stringify({ tools: [] }),
    );
    await expect(loadToolManifest(deployDir)).rejects.toThrow(
      /Unsupported tool manifest version undefined \(expected 1\)/,
    );
  });
});

describe("upsertEntry", () => {
  it("adds a new entry", () => {
    const manifest: ToolManifest = { version: 1, tools: [] };
    const entry: ToolManifestEntry = { name: "email", source: "registry", installedAt: "2026-01-01T00:00:00Z" };
    const result = upsertEntry(manifest, entry);
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe("email");
  });

  it("replaces an existing entry with same name", () => {
    const manifest: ToolManifest = {
      version: 1,
      tools: [{ name: "email", source: "registry", installedAt: "2026-01-01T00:00:00Z" }],
    };
    const entry: ToolManifestEntry = { name: "email", source: "registry", installedAt: "2026-02-01T00:00:00Z" };
    const result = upsertEntry(manifest, entry);
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].installedAt).toBe("2026-02-01T00:00:00Z");
  });
});

describe("removeEntry", () => {
  it("removes an entry by name", () => {
    const manifest: ToolManifest = {
      version: 1,
      tools: [
        { name: "email", source: "registry", installedAt: "2026-01-01T00:00:00Z" },
        { name: "tasks", source: "registry", installedAt: "2026-01-01T00:00:00Z" },
      ],
    };
    const result = removeEntry(manifest, "email");
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe("tasks");
  });

  it("returns unchanged manifest when name not found", () => {
    const manifest: ToolManifest = {
      version: 1,
      tools: [{ name: "email", source: "registry", installedAt: "2026-01-01T00:00:00Z" }],
    };
    const result = removeEntry(manifest, "nonexistent");
    expect(result.tools).toHaveLength(1);
  });
});

// ── List Formatting ─────────────────────────────────────────────────────────

describe("formatToolList", () => {
  it("shows helpful message when no tools installed", () => {
    const output = formatToolList({ tools: [], total: 0 });
    expect(output).toContain("No tools installed");
    expect(output).toContain("clawhq tool install");
    // Should list available tools
    expect(output).toContain("email");
  });

  it("formats tool table when tools are installed", () => {
    const output = formatToolList({
      tools: [
        { name: "email", source: "registry", installedAt: "2026-01-15T10:00:00Z" },
        { name: "tasks", source: "registry", installedAt: "2026-01-16T10:00:00Z" },
      ],
      total: 2,
    });
    expect(output).toContain("email");
    expect(output).toContain("tasks");
    expect(output).toContain("registry");
    expect(output).toContain("Installed tools: 2");
  });
});

describe("formatToolListJson", () => {
  it("returns valid JSON", () => {
    const output = formatToolListJson({
      tools: [{ name: "email", source: "registry", installedAt: "2026-01-15T10:00:00Z" }],
      total: 1,
    });
    const parsed = JSON.parse(output);
    expect(parsed.total).toBe(1);
    expect(parsed.tools).toHaveLength(1);
    expect(parsed.tools[0].name).toBe("email");
  });

  it("returns valid JSON for empty list", () => {
    const output = formatToolListJson({ tools: [], total: 0 });
    const parsed = JSON.parse(output);
    expect(parsed.total).toBe(0);
    expect(parsed.tools).toHaveLength(0);
  });
});

// ── Lifecycle (install/remove/list) ─────────────────────────────────────────
// These tests use skipRebuild to avoid needing Docker during tests.

// We dynamically import lifecycle to avoid build module side-effects at
// module level. The functions are tested with skipRebuild: true.
describe("installTool", () => {
  it("installs a tool from the registry", async () => {
    const { installTool } = await import("./lifecycle.js");
    const result = await installTool({
      deployDir,
      name: "email",
      skipRebuild: true,
    });

    expect(result.success).toBe(true);
    expect(result.toolName).toBe("email");
    expect(result.rebuilt).toBe(false); // skipRebuild

    // Verify tool file exists and is non-empty
    const toolPath = join(deployDir, "workspace", "tools", "email");
    expect(existsSync(toolPath)).toBe(true);
    const content = readFileSync(toolPath, "utf-8");
    expect(content.length).toBeGreaterThan(0);

    // Verify manifest updated
    const manifest = await loadToolManifest(deployDir);
    expect(manifest.tools).toHaveLength(1);
    expect(manifest.tools[0].name).toBe("email");
    expect(manifest.tools[0].source).toBe("registry");
  });

  it("rejects unknown tool name", async () => {
    const { installTool } = await import("./lifecycle.js");
    const result = await installTool({
      deployDir,
      name: "nonexistent-tool",
      skipRebuild: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unknown tool/);
    expect(result.error).toContain("nonexistent-tool");
  });

  it("rejects already-installed tool", async () => {
    const { installTool } = await import("./lifecycle.js");
    // First install
    await installTool({ deployDir, name: "email", skipRebuild: true });
    // Second install
    const result = await installTool({ deployDir, name: "email", skipRebuild: true });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already installed/);
  });

  it("installs multiple tools", async () => {
    const { installTool } = await import("./lifecycle.js");
    await installTool({ deployDir, name: "email", skipRebuild: true });
    await installTool({ deployDir, name: "tasks", skipRebuild: true });
    await installTool({ deployDir, name: "quote", skipRebuild: true });

    const manifest = await loadToolManifest(deployDir);
    expect(manifest.tools).toHaveLength(3);
    expect(manifest.tools.map((t) => t.name)).toContain("email");
    expect(manifest.tools.map((t) => t.name)).toContain("tasks");
    expect(manifest.tools.map((t) => t.name)).toContain("quote");
  });
});

describe("removeTool", () => {
  it("removes an installed tool", async () => {
    const { installTool, removeTool } = await import("./lifecycle.js");
    await installTool({ deployDir, name: "email", skipRebuild: true });

    const result = await removeTool({ deployDir, name: "email", skipRebuild: true });
    expect(result.success).toBe(true);
    expect(result.toolName).toBe("email");

    // Verify tool file removed
    expect(existsSync(join(deployDir, "workspace", "tools", "email"))).toBe(false);

    // Verify manifest updated
    const manifest = await loadToolManifest(deployDir);
    expect(manifest.tools).toHaveLength(0);
  });

  it("returns error for non-installed tool", async () => {
    const { removeTool } = await import("./lifecycle.js");
    const result = await removeTool({ deployDir, name: "nonexistent", skipRebuild: true });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not installed/);
  });
});

describe("listTools", () => {
  it("returns empty list when no tools installed", async () => {
    const { listTools } = await import("./lifecycle.js");
    const result = await listTools({ deployDir });
    expect(result.total).toBe(0);
    expect(result.tools).toHaveLength(0);
  });

  it("lists installed tools", async () => {
    const { installTool, listTools } = await import("./lifecycle.js");
    await installTool({ deployDir, name: "email", skipRebuild: true });
    await installTool({ deployDir, name: "tasks", skipRebuild: true });

    const result = await listTools({ deployDir });
    expect(result.total).toBe(2);
    expect(result.tools.map((t) => t.name)).toContain("email");
    expect(result.tools.map((t) => t.name)).toContain("tasks");
  });
});

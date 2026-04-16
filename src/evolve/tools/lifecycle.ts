/**
 * Tool lifecycle — install, remove, list.
 *
 * Tools come from the known TOOL_GENERATORS registry in src/design/tools/.
 * Install writes the generated script to workspace/tools/, updates the
 * manifest, and triggers a Stage 2 rebuild so the container picks it up.
 */

import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { build } from "../../build/docker/build.js";
import type { Stage1Config, Stage2Config } from "../../build/docker/types.js";
import { DIR_MODE_SECRET } from "../../config/defaults.js";

import {
  loadToolManifest,
  removeEntry,
  saveToolManifest,
  upsertEntry,
} from "./manifest.js";
import { TOOL_REGISTRY } from "./registry.js";
import type {
  ToolAddOptions,
  ToolInstallOptions,
  ToolInstallResult,
  ToolListOptions,
  ToolListResult,
  ToolManifestEntry,
  ToolRemoveOptions,
  ToolRemoveResult,
} from "./types.js";

// ── Install ─────────────────────────────────────────────────────────────────

/**
 * Install a tool from the registry.
 *
 * 1. Validate tool exists in registry
 * 2. Generate tool script
 * 3. Write to workspace/tools/<name>
 * 4. Update .tool-manifest.json
 * 5. Trigger Stage 2 rebuild
 */
export async function installTool(
  options: ToolInstallOptions,
): Promise<ToolInstallResult> {
  const { deployDir, name } = options;

  // Validate tool exists in registry
  const generator = TOOL_REGISTRY[name];
  if (!generator) {
    const available = Object.keys(TOOL_REGISTRY).join(", ");
    return {
      success: false,
      toolName: name,
      rebuilt: false,
      error: `Unknown tool "${name}". Available tools: ${available}`,
    };
  }

  // Check if already installed
  const manifest = await loadToolManifest(deployDir);
  const existing = manifest.tools.find((t) => t.name === name);
  if (existing) {
    return {
      success: false,
      toolName: name,
      rebuilt: false,
      error: `Tool "${name}" is already installed. Remove it first to reinstall.`,
    };
  }

  // Generate tool script
  const content = generator();
  const toolsDir = join(deployDir, "workspace", "tools");
  mkdirSync(toolsDir, { recursive: true, mode: DIR_MODE_SECRET });
  chmodSync(toolsDir, DIR_MODE_SECRET);

  const toolPath = join(toolsDir, name);
  const tmpPath = toolPath + `.tmp.${Date.now()}`;
  await writeFile(tmpPath, content, { encoding: "utf-8", mode: 0o755 });
  await rename(tmpPath, toolPath);

  // Update manifest
  const entry: ToolManifestEntry = {
    name,
    source: "registry",
    installedAt: new Date().toISOString(),
  };
  const updated = upsertEntry(manifest, entry);
  await saveToolManifest(deployDir, updated);

  // Trigger Stage 2 rebuild
  let rebuilt = false;
  if (!options.skipRebuild) {
    const rebuildResult = await triggerStage2Rebuild(deployDir, updated.tools.map((t) => t.name));
    if (!rebuildResult.success) {
      return {
        success: true,
        toolName: name,
        rebuilt: false,
        error: `Tool installed but Stage 2 rebuild failed: ${rebuildResult.error}`,
      };
    }
    rebuilt = true;
  }

  return { success: true, toolName: name, rebuilt };
}

// ── Add Custom Tool ────────────────────────────────────────────────────────

/**
 * Add a custom tool from a file path.
 *
 * Unlike installTool (which uses the registry), this accepts any executable
 * script. The tool is vetted for basic safety (shebang, no binary content),
 * copied to workspace/tools/, tracked in the manifest as source: "custom",
 * and triggers a Stage 2 rebuild.
 */
export async function addCustomTool(
  options: ToolAddOptions,
): Promise<ToolInstallResult> {
  const { deployDir, sourcePath } = options;
  const { basename } = await import("node:path");

  // Derive tool name from filename (strip extension)
  const fileName = basename(sourcePath);
  const name = options.name ?? fileName.replace(/\.(sh|bash|py|js|ts)$/, "");

  // Validate source exists and is readable
  if (!existsSync(sourcePath)) {
    return {
      success: false,
      toolName: name,
      rebuilt: false,
      error: `Source file not found: ${sourcePath}`,
    };
  }

  // Read and validate content
  const content = await readFile(sourcePath, "utf-8");

  // Must have a shebang
  if (!content.startsWith("#!")) {
    return {
      success: false,
      toolName: name,
      rebuilt: false,
      error: `Tool script must start with a shebang (e.g. #!/usr/bin/env bash). Got: ${content.slice(0, 40)}`,
    };
  }

  // Reject binary content (NUL bytes)
  if (content.includes("\0")) {
    return {
      success: false,
      toolName: name,
      rebuilt: false,
      error: "Tool script appears to contain binary content. Only text scripts are supported.",
    };
  }

  // Check if already installed
  const manifest = await loadToolManifest(deployDir);
  const existing = manifest.tools.find((t) => t.name === name);
  if (existing) {
    return {
      success: false,
      toolName: name,
      rebuilt: false,
      error: `Tool "${name}" is already installed. Remove it first to reinstall.`,
    };
  }

  // Write to workspace/tools/
  const toolsDir = join(deployDir, "workspace", "tools");
  mkdirSync(toolsDir, { recursive: true, mode: DIR_MODE_SECRET });
  chmodSync(toolsDir, DIR_MODE_SECRET);

  const toolPath = join(toolsDir, name);
  const tmpPath = toolPath + `.tmp.${Date.now()}`;
  await writeFile(tmpPath, content, { encoding: "utf-8", mode: 0o755 });
  await rename(tmpPath, toolPath);

  // Update manifest
  const entry: ToolManifestEntry = {
    name,
    source: `custom:${sourcePath}`,
    installedAt: new Date().toISOString(),
  };
  const updated = upsertEntry(manifest, entry);
  await saveToolManifest(deployDir, updated);

  // Trigger Stage 2 rebuild
  let rebuilt = false;
  if (!options.skipRebuild) {
    const rebuildResult = await triggerStage2Rebuild(deployDir, updated.tools.map((t) => t.name));
    if (!rebuildResult.success) {
      return {
        success: true,
        toolName: name,
        rebuilt: false,
        error: `Tool added but Stage 2 rebuild failed: ${rebuildResult.error}`,
      };
    }
    rebuilt = true;
  }

  return { success: true, toolName: name, rebuilt };
}

// ── Remove ──────────────────────────────────────────────────────────────────

/**
 * Remove an installed tool.
 *
 * 1. Remove from manifest
 * 2. Delete tool file
 * 3. Trigger Stage 2 rebuild
 */
export async function removeTool(
  options: ToolRemoveOptions,
): Promise<ToolRemoveResult> {
  const { deployDir, name } = options;

  const manifest = await loadToolManifest(deployDir);
  const entry = manifest.tools.find((t) => t.name === name);
  if (!entry) {
    return {
      success: false,
      toolName: name,
      rebuilt: false,
      error: `Tool "${name}" is not installed.`,
    };
  }

  // Remove tool file
  const toolPath = join(deployDir, "workspace", "tools", name);
  if (existsSync(toolPath)) {
    await rm(toolPath, { force: true });
  }

  // Update manifest
  const updated = removeEntry(manifest, name);
  await saveToolManifest(deployDir, updated);

  // Trigger Stage 2 rebuild
  let rebuilt = false;
  if (!options.skipRebuild) {
    const rebuildResult = await triggerStage2Rebuild(deployDir, updated.tools.map((t) => t.name));
    if (!rebuildResult.success) {
      return {
        success: true,
        toolName: name,
        rebuilt: false,
        error: `Tool removed but Stage 2 rebuild failed: ${rebuildResult.error}`,
      };
    }
    rebuilt = true;
  }

  return { success: true, toolName: name, rebuilt };
}

// ── List ────────────────────────────────────────────────────────────────────

/**
 * List all installed tools.
 */
export async function listTools(
  options: ToolListOptions,
): Promise<ToolListResult> {
  const manifest = await loadToolManifest(options.deployDir);
  return {
    tools: manifest.tools,
    total: manifest.tools.length,
  };
}

// ── Stage 2 Rebuild ─────────────────────────────────────────────────────────

/**
 * Trigger a Stage 2 rebuild with the current tool list.
 *
 * Reads the existing build manifest to preserve Stage 1 config and skill list,
 * then rebuilds with updated workspace tools.
 */
async function triggerStage2Rebuild(
  deployDir: string,
  toolNames: readonly string[],
): Promise<{ success: boolean; error?: string }> {
  try {
    // Stage 1 config — use defaults (base image + no extra apt packages)
    const stage1: Stage1Config = {
      baseImage: "openclaw:latest",
      aptPackages: [],
    };

    // Collect current skills from skill manifest
    const skillNames = await getInstalledSkillNames(deployDir);

    // Stage 2 config — updated tool list
    const stage2: Stage2Config = {
      binaries: [],
      workspaceTools: [...toolNames],
      skills: skillNames,
    };

    const result = await build({
      deployDir,
      stage1,
      stage2,
      noCache: false,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/** Read installed skill names from the skill manifest. */
async function getInstalledSkillNames(deployDir: string): Promise<string[]> {
  try {
    const path = join(deployDir, "workspace", "skills", ".skill-manifest.json");
    const raw = await readFile(path, "utf-8");
    const manifest = JSON.parse(raw) as { skills: Array<{ name: string; status: string }> };
    return manifest.skills
      .filter((s) => s.status === "active")
      .map((s) => s.name);
  } catch {
    return [];
  }
}

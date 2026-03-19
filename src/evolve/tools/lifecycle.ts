/**
 * Tool lifecycle — install, remove, list.
 *
 * Tools come from the known TOOL_GENERATORS registry in src/design/tools/.
 * Install writes the generated script to workspace/tools/, updates the
 * manifest, and triggers a Stage 2 rebuild so the container picks it up.
 */

import { existsSync, mkdirSync } from "node:fs";
import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { build } from "../../build/docker/build.js";
import type { Stage1Config, Stage2Config } from "../../build/docker/types.js";
import { TOOL_REGISTRY } from "./registry.js";
import {
  loadToolManifest,
  removeEntry,
  saveToolManifest,
  upsertEntry,
} from "./manifest.js";
import type {
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
  mkdirSync(toolsDir, { recursive: true });

  const toolPath = join(toolsDir, name);
  await writeFile(toolPath, content, "utf-8");
  await chmod(toolPath, 0o755);

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

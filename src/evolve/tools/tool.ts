/**
 * Tool lifecycle operations — install, list, remove.
 *
 * Tools are CLI binaries added to the agent's Docker image via Dockerfile
 * fragments. Installing a tool updates the persistent registry and signals
 * that a container rebuild is needed.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { generateDockerfile } from "../../build/docker/dockerfile.js";

import {
  addTool,
  findKnownTool,
  findTool,
  KNOWN_TOOLS,
  loadRegistry,
  removeTool,
  saveRegistry,
} from "./registry.js";
import type { InstalledTool, ToolContext, ToolDefinition } from "./types.js";
import { ToolError } from "./types.js";

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

export interface InstallResult {
  tool: InstalledTool;
  definition: ToolDefinition;
  requiresRebuild: boolean;
}

/**
 * Install a CLI tool — adds it to the registry.
 *
 * The tool must be in the known tools catalog. After installing, the user
 * must run `clawhq build` to rebuild the Docker image with the new binary.
 */
export async function installTool(
  ctx: ToolContext,
  name: string,
): Promise<InstallResult> {
  const definition = findKnownTool(name);
  if (!definition) {
    const available = KNOWN_TOOLS
      .filter((t) => !t.alwaysIncluded)
      .map((t) => t.name)
      .join(", ");
    throw new ToolError(
      `Unknown tool "${name}". Available tools: ${available}`,
      "UNKNOWN_TOOL",
    );
  }

  if (definition.alwaysIncluded) {
    throw new ToolError(
      `Tool "${name}" is always included in every build. No need to install it.`,
      "ALWAYS_INCLUDED",
    );
  }

  const registry = await loadRegistry(ctx);
  if (findTool(registry, name)) {
    throw new ToolError(
      `Tool "${name}" is already installed.`,
      "ALREADY_INSTALLED",
    );
  }

  const now = new Date().toISOString();
  const tool: InstalledTool = {
    name,
    installedAt: now,
    explicit: true,
  };

  const updated = addTool(registry, tool);
  await saveRegistry(ctx, updated);

  return {
    tool,
    definition,
    requiresRebuild: true,
  };
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export interface ToolListEntry {
  name: string;
  description: string;
  installed: boolean;
  alwaysIncluded: boolean;
  installedAt: string | null;
  tags: string[];
}

/**
 * List all known tools with their installation status.
 */
export async function listTools(ctx: ToolContext): Promise<ToolListEntry[]> {
  const registry = await loadRegistry(ctx);

  return KNOWN_TOOLS.map((def) => {
    const installed = findTool(registry, def.name);
    return {
      name: def.name,
      description: def.description,
      installed: !!installed || def.alwaysIncluded,
      alwaysIncluded: def.alwaysIncluded,
      installedAt: installed?.installedAt ?? null,
      tags: def.tags,
    };
  });
}

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------

export interface RemoveResult {
  tool: InstalledTool;
  requiresRebuild: boolean;
}

/**
 * Remove a CLI tool from the registry.
 *
 * Cannot remove always-included tools. After removing, the user must run
 * `clawhq build` to rebuild without the binary.
 */
export async function removeToolOp(
  ctx: ToolContext,
  name: string,
): Promise<RemoveResult> {
  const definition = findKnownTool(name);
  if (definition?.alwaysIncluded) {
    throw new ToolError(
      `Tool "${name}" is always included in every build and cannot be removed.`,
      "ALWAYS_INCLUDED",
    );
  }

  const registry = await loadRegistry(ctx);
  const tool = findTool(registry, name);

  if (!tool) {
    throw new ToolError(
      `Tool "${name}" is not installed.`,
      "NOT_FOUND",
    );
  }

  const updated = removeTool(registry, name);
  await saveRegistry(ctx, updated);

  return {
    tool,
    requiresRebuild: true,
  };
}

// ---------------------------------------------------------------------------
// Dockerfile integration
// ---------------------------------------------------------------------------

/**
 * Get the set of binary names that should be included in the Dockerfile,
 * combining always-included tools with explicitly installed ones.
 */
export async function getRequiredBinaries(ctx: ToolContext): Promise<Set<string>> {
  const registry = await loadRegistry(ctx);
  const binaries = new Set<string>();

  // Always-included
  for (const def of KNOWN_TOOLS) {
    if (def.alwaysIncluded) {
      binaries.add(def.name);
    }
  }

  // Explicitly installed
  for (const tool of registry.tools) {
    binaries.add(tool.name);
  }

  return binaries;
}

// ---------------------------------------------------------------------------
// Dockerfile patching
// ---------------------------------------------------------------------------

export interface PatchResult {
  dockerfilePath: string;
  binaries: string[];
}

/**
 * Regenerate the Stage 2 Dockerfile based on the current tool registry.
 *
 * Called after install/remove to keep the Dockerfile in sync with the
 * registry. The next `clawhq build` (or an auto-triggered rebuild)
 * will pick up the changes.
 */
export async function patchDockerfile(
  ctx: ToolContext,
  deployDir: string,
): Promise<PatchResult> {
  const requiredBinaries = await getRequiredBinaries(ctx);
  const content = generateDockerfile({ requiredBinaries });

  await mkdir(deployDir, { recursive: true });
  const dockerfilePath = join(deployDir, "Dockerfile");
  await writeFile(dockerfilePath, content, "utf-8");

  return {
    dockerfilePath,
    binaries: [...requiredBinaries].sort(),
  };
}

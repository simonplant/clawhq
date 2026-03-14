/**
 * Tool registry — persistent JSON storage for installed tool metadata,
 * plus the catalog of known tools and their install recipes.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { InstalledTool, ToolContext, ToolDefinition, ToolRegistry } from "./types.js";

// ---------------------------------------------------------------------------
// Known tools catalog — every tool ClawHQ knows how to install.
// ---------------------------------------------------------------------------

export const KNOWN_TOOLS: ToolDefinition[] = [
  {
    name: "curl",
    description: "HTTP client — latest static build, replaces Debian 12's 7.88",
    installMethod: "binary",
    verifyCmd: "curl --version",
    alwaysIncluded: true,
    tags: ["http", "network", "data"],
  },
  {
    name: "jq",
    description: "JSON processor — latest static binary, replaces Debian 12's 1.6",
    installMethod: "binary",
    verifyCmd: "jq --version",
    alwaysIncluded: true,
    tags: ["json", "data", "transform"],
  },
  {
    name: "rg",
    description: "ripgrep — fast recursive search, static musl binary",
    installMethod: "binary",
    verifyCmd: "rg --version",
    alwaysIncluded: true,
    tags: ["search", "text"],
  },
  {
    name: "himalaya",
    description: "Email client — IMAP/SMTP via CLI, static musl binary",
    installMethod: "binary",
    verifyCmd: "himalaya --version",
    alwaysIncluded: false,
    tags: ["email", "communication"],
  },
  {
    name: "gh",
    description: "GitHub CLI — repos, issues, PRs, actions",
    installMethod: "binary",
    verifyCmd: "gh --version",
    alwaysIncluded: false,
    tags: ["github", "git", "development"],
  },
  {
    name: "git",
    description: "Git — latest stable from source, replaces Debian 12's 2.39",
    installMethod: "binary",
    verifyCmd: "git --version",
    alwaysIncluded: false,
    tags: ["vcs", "development"],
  },
  {
    name: "ffmpeg",
    description: "Audio/video processing — latest static build",
    installMethod: "binary",
    verifyCmd: "ffmpeg -version",
    alwaysIncluded: false,
    tags: ["media", "audio", "video"],
  },
  {
    name: "yq",
    description: "YAML/JSON/XML processor — like jq but for YAML",
    installMethod: "binary",
    verifyCmd: "yq --version",
    alwaysIncluded: false,
    tags: ["yaml", "data", "transform"],
  },
];

/**
 * Look up a tool definition by name.
 */
export function findKnownTool(name: string): ToolDefinition | undefined {
  return KNOWN_TOOLS.find((t) => t.name === name);
}

// ---------------------------------------------------------------------------
// Persistent registry — tracks which tools are installed in this deployment.
// ---------------------------------------------------------------------------

const REGISTRY_FILE = "tools/registry.json";

function registryPath(ctx: ToolContext): string {
  return join(ctx.clawhqDir, REGISTRY_FILE);
}

export async function loadRegistry(ctx: ToolContext): Promise<ToolRegistry> {
  const path = registryPath(ctx);
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as ToolRegistry;
  } catch {
    return { tools: [] };
  }
}

export async function saveRegistry(
  ctx: ToolContext,
  registry: ToolRegistry,
): Promise<void> {
  const path = registryPath(ctx);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(registry, null, 2) + "\n", "utf-8");
}

export function findTool(
  registry: ToolRegistry,
  name: string,
): InstalledTool | undefined {
  return registry.tools.find((t) => t.name === name);
}

export function addTool(
  registry: ToolRegistry,
  tool: InstalledTool,
): ToolRegistry {
  return {
    tools: [...registry.tools, tool],
  };
}

export function removeTool(
  registry: ToolRegistry,
  name: string,
): ToolRegistry {
  return {
    tools: registry.tools.filter((t) => t.name !== name),
  };
}

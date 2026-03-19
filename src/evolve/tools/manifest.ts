/**
 * Tool manifest I/O — reads and writes .tool-manifest.json.
 *
 * Tracks which tools are installed, their source, and when they were added.
 * The manifest drives Stage 2 Dockerfile generation — tools listed here
 * get COPY'd into the container.
 */

import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ToolManifest, ToolManifestEntry } from "./types.js";

const MANIFEST_FILENAME = ".tool-manifest.json";

/** Path to the tool manifest file. */
export function toolManifestPath(deployDir: string): string {
  return join(deployDir, "workspace", "tools", MANIFEST_FILENAME);
}

/** Load the tool manifest. Returns empty manifest if none exists. */
export async function loadToolManifest(deployDir: string): Promise<ToolManifest> {
  const path = toolManifestPath(deployDir);
  if (!existsSync(path)) {
    return { version: 1, tools: [] };
  }
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as ToolManifest;
  } catch {
    return { version: 1, tools: [] };
  }
}

/** Save the tool manifest to disk. */
export async function saveToolManifest(
  deployDir: string,
  manifest: ToolManifest,
): Promise<void> {
  const dir = join(deployDir, "workspace", "tools");
  mkdirSync(dir, { recursive: true });
  await writeFile(toolManifestPath(deployDir), JSON.stringify(manifest, null, 2) + "\n");
}

/** Add or replace an entry in the manifest. */
export function upsertEntry(
  manifest: ToolManifest,
  entry: ToolManifestEntry,
): ToolManifest {
  const filtered = manifest.tools.filter((t) => t.name !== entry.name);
  return { ...manifest, tools: [...filtered, entry] };
}

/** Remove an entry from the manifest. */
export function removeEntry(
  manifest: ToolManifest,
  toolName: string,
): ToolManifest {
  return {
    ...manifest,
    tools: manifest.tools.filter((t) => t.name !== toolName),
  };
}

/**
 * Workspace metrics collector.
 *
 * Scans the OpenClaw workspace directory for memory files (by tier)
 * and identity files, reporting sizes and estimated token counts.
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import type { IdentityFile, MemoryTier, WorkspaceMetrics } from "./types.js";

/** Approximate tokens per byte for plain text (conservative ~4 chars/token). */
const BYTES_PER_TOKEN = 4;

/**
 * Memory tier definitions relative to workspace root.
 * OpenClaw uses hot/warm/cold memory tiers under workspace/memory/.
 */
const MEMORY_TIERS = [
  { tier: "hot", subdir: "memory/hot" },
  { tier: "warm", subdir: "memory/warm" },
  { tier: "cold", subdir: "memory/cold" },
];

/** Identity file names in the workspace root. */
const IDENTITY_FILES = [
  "IDENTITY.md",
  "USER.md",
  "RULES.md",
  "GUIDELINES.md",
];

/**
 * Sum the size of all files in a directory (non-recursive).
 */
async function dirStats(dirPath: string): Promise<{ sizeBytes: number; fileCount: number }> {
  let sizeBytes = 0;
  let fileCount = 0;

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        try {
          const s = await stat(join(dirPath, entry.name));
          sizeBytes += s.size;
          fileCount++;
        } catch {
          // Skip unreadable files
        }
      }
    }
  } catch {
    // Directory doesn't exist — return zeros
  }

  return { sizeBytes, fileCount };
}

/**
 * Get file size, returning 0 if the file doesn't exist.
 */
async function fileSize(filePath: string): Promise<number> {
  try {
    const s = await stat(filePath);
    return s.size;
  } catch {
    return 0;
  }
}

/**
 * Collect workspace metrics: memory tier sizes and identity file token counts.
 */
export async function collectWorkspaceMetrics(options: {
  openclawHome?: string;
} = {}): Promise<WorkspaceMetrics> {
  const home = (options.openclawHome ?? "~/.openclaw").replace(
    /^~/,
    process.env.HOME ?? "~",
  );
  const workspacePath = join(home, "workspace");

  // Collect memory tiers
  const memoryTiers: MemoryTier[] = [];
  let totalMemoryBytes = 0;

  for (const { tier, subdir } of MEMORY_TIERS) {
    const dirPath = join(workspacePath, subdir);
    const stats = await dirStats(dirPath);
    memoryTiers.push({
      tier,
      path: dirPath,
      sizeBytes: stats.sizeBytes,
      fileCount: stats.fileCount,
    });
    totalMemoryBytes += stats.sizeBytes;
  }

  // Collect identity files
  const identityFiles: IdentityFile[] = [];
  let totalIdentityTokens = 0;

  for (const name of IDENTITY_FILES) {
    const filePath = join(workspacePath, name);
    const size = await fileSize(filePath);
    if (size > 0) {
      const estimatedTokens = Math.ceil(size / BYTES_PER_TOKEN);
      identityFiles.push({
        name,
        path: filePath,
        sizeBytes: size,
        estimatedTokens,
      });
      totalIdentityTokens += estimatedTokens;
    }
  }

  return {
    memoryTiers,
    identityFiles,
    totalMemoryBytes,
    totalIdentityTokens,
  };
}

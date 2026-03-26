/**
 * Recursive directory walk for the scanner.
 *
 * Walks the workspace directory, skipping binary files, node_modules,
 * and other non-scannable paths. Respects .gitignore-style skips.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import { SKIP_DIRS, shouldSkipFile } from "./patterns.js";
import { scanContent } from "./scanner.js";
import type { Finding } from "./types.js";

// ── Public API ──────────────────────────────────────────────────────────────

export interface WalkResult {
  readonly findings: Finding[];
  readonly filesScanned: number;
}

/**
 * Recursively scan a directory for secrets and PII.
 *
 * Walks all files, skipping binary/irrelevant files and directories.
 * Returns findings and the count of files scanned.
 */
export async function walkAndScan(
  rootDir: string,
  signal?: AbortSignal,
): Promise<WalkResult> {
  const findings: Finding[] = [];
  let filesScanned = 0;

  async function walk(dir: string): Promise<void> {
    if (signal?.aborted) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (signal?.aborted) return;

      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(fullPath);
      } else if (entry.isFile()) {
        if (shouldSkipFile(entry.name)) continue;

        // Skip large files (> 1MB) — unlikely to be config, likely binary
        try {
          const info = await stat(fullPath);
          if (info.size > 1_048_576) continue;
          if (info.size === 0) continue;
        } catch {
          continue;
        }

        // Skip binary files
        let content: string;
        try {
          content = await readFile(fullPath, "utf-8");
        } catch {
          continue;
        }

        if (isBinary(content)) continue;

        const relPath = relative(rootDir, fullPath);
        const fileFindings = scanContent(content, relPath, "file");
        findings.push(...fileFindings);
        filesScanned++;
      }
    }
  }

  await walk(rootDir);
  return { findings, filesScanned };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Heuristic binary check — if the first 8KB contains null bytes, it's binary. */
function isBinary(content: string): boolean {
  const sample = content.slice(0, 8192);
  return sample.includes("\0");
}

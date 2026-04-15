/**
 * Workspace integrity manifest — SHA256 checksums for immutable files.
 *
 * Generated at build time and baked into the Docker image at
 * /opt/workspace-integrity.json. Used by `clawhq doctor` to detect
 * tampered or corrupted workspace files at runtime.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// ── Types ───────────────────────────────────────────────────────────────────

export interface IntegrityEntry {
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface IntegrityManifest {
  readonly files: readonly IntegrityEntry[];
  readonly generatedAt: string;
  readonly totalFiles: number;
}

// ── Generator ───────────────────────────────────────────────────────────────

/**
 * Generate SHA256 integrity manifest for all immutable workspace files.
 *
 * Reads each file from the engine directory's staged workspace copy,
 * computes its SHA256 hash, and produces a manifest suitable for
 * embedding at /opt/workspace-integrity.json in the Docker image.
 */
export async function generateIntegrityManifest(
  engineDir: string,
  immutablePaths: readonly string[],
): Promise<IntegrityManifest> {
  const files: IntegrityEntry[] = [];

  for (const relPath of immutablePaths) {
    const absPath = join(engineDir, "workspace", relPath);
    if (!existsSync(absPath)) continue;
    const content = await readFile(absPath);
    const sha256 = createHash("sha256").update(content).digest("hex");
    files.push({ path: relPath, sha256, sizeBytes: content.length });
  }

  return {
    files,
    generatedAt: new Date().toISOString(),
    totalFiles: files.length,
  };
}

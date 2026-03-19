/**
 * Hash-based change detection for Docker build cache invalidation.
 *
 * Stage 1 (base image) rebuilds rarely. Hash-based detection means
 * `clawhq build` doesn't waste the user's time rebuilding unchanged layers.
 *
 * Hashes are computed from the inputs that affect each stage:
 * - Stage 1: base image tag + apt package list
 * - Stage 2: binary URLs + workspace tools + skills
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { BuildManifest, CacheCheckResult, Stage1Config, Stage2Config } from "./types.js";

// ── Hash Computation ────────────────────────────────────────────────────────

/** Compute a deterministic hash of Stage 1 inputs. */
export function computeStage1Hash(config: Stage1Config): string {
  const data = JSON.stringify({
    baseImage: config.baseImage,
    aptPackages: [...config.aptPackages].sort(),
  });
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

/** Compute a deterministic hash of Stage 2 inputs. */
export function computeStage2Hash(config: Stage2Config): string {
  const data = JSON.stringify({
    binaries: config.binaries.map((b) => ({ name: b.name, url: b.url })),
    workspaceTools: [...config.workspaceTools].sort(),
    skills: [...config.skills].sort(),
  });
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

// ── Cache Check ─────────────────────────────────────────────────────────────

/** Path to the build manifest within the deploy directory. */
export function manifestPath(deployDir: string): string {
  return join(deployDir, "engine", "build-manifest.json");
}

/**
 * Check if Stage 1 or Stage 2 inputs have changed since the last build.
 *
 * Reads the previous build manifest and compares hashes. If no manifest
 * exists, both stages are considered changed.
 */
export async function checkCache(
  deployDir: string,
  stage1: Stage1Config,
  stage2: Stage2Config,
): Promise<CacheCheckResult> {
  const currentStage1Hash = computeStage1Hash(stage1);
  const currentStage2Hash = computeStage2Hash(stage2);

  let previousStage1Hash: string | null = null;
  let previousStage2Hash: string | null = null;

  try {
    const raw = await readFile(manifestPath(deployDir), "utf-8");
    const manifest = JSON.parse(raw) as BuildManifest;
    previousStage1Hash = manifest.stage1Hash;
    previousStage2Hash = manifest.stage2Hash;
  } catch (e) {
    console.warn(`[docker:cache] Failed to read previous manifest:`, e);
    // No previous manifest — treat as changed
  }

  return {
    stage1Changed: currentStage1Hash !== previousStage1Hash,
    stage2Changed: currentStage2Hash !== previousStage2Hash,
    currentStage1Hash,
    currentStage2Hash,
    previousStage1Hash,
    previousStage2Hash,
  };
}

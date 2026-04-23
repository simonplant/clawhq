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

/**
 * Compute a deterministic hash of Stage 2 inputs.
 *
 * Inputs:
 *   - binaries[] sorted by name, reduced to the fields that actually change
 *     what goes into the image (name + url + sha256).
 *   - workspaceTools, skills — legacy lists, sorted.
 *   - enableOnePassword — affects the binary set emitted into the Dockerfile.
 *   - workspace manifest — all four lists (immutable, persistent, config,
 *     ephemeral) contribute. Previously only immutable+persistent were
 *     hashed, so adding a workspace/config/ file never invalidated the
 *     cache and the container ran with stale read-only mounts. Same story
 *     for the ephemeral tmpfs mount list.
 *   - posture — compose volumes, tmpfs sizes, healthcheck intervals, and
 *     gVisor runtime selection all derive from posture. A posture change
 *     that doesn't also change another hashed input has to invalidate the
 *     cache on its own.
 */
export function computeStage2Hash(config: Stage2Config): string {
  const data = JSON.stringify({
    binaries: [...config.binaries]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((b) => ({ name: b.name, url: b.url, sha256: b.sha256 })),
    workspaceTools: [...config.workspaceTools].sort(),
    skills: [...config.skills].sort(),
    enableOnePassword: config.enableOnePassword ?? false,
    workspace: config.workspace ? {
      immutable: [...config.workspace.immutable].sort(),
      persistent: [...config.workspace.persistent].sort(),
      config: [...config.workspace.config].sort(),
      ephemeral: [...config.workspace.ephemeral].sort(),
    } : null,
    posture: config.posture ?? null,
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
  } catch {
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

/**
 * Two-stage Docker build orchestration.
 *
 * Stage 1: Base OpenClaw image + apt packages (rebuilt only when upstream changes).
 * Stage 2: Custom tools + skills layer (fast rebuild on config changes).
 *
 * See docs/ARCHITECTURE.md and OPENCLAW-REFERENCE.md for build architecture.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { DockerClient, ImageInspectResult } from "./client.js";

// --- Build stage types ---

export interface BuildStageResult {
  stage: 1 | 2;
  success: boolean;
  imageTag: string;
  durationMs: number;
}

export interface TwoStageBuildOptions {
  /** Build context directory (OpenClaw source root). */
  context: string;
  /** Base image tag for Stage 1. */
  baseTag: string;
  /** Final image tag for Stage 2. */
  finalTag: string;
  /** Dockerfile path (if not default). */
  dockerfile?: string;
  /** Build args for Stage 1 (e.g., apt packages). */
  stage1Args?: Record<string, string>;
  /** Build args for Stage 2 (e.g., custom tools). */
  stage2Args?: Record<string, string>;
  /** Skip Stage 1 entirely (--stage2-only). */
  skipStage1?: boolean;
  /** Skip Stage 1 if base image already exists and inputs haven't changed. */
  skipStage1IfExists?: boolean;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

export interface TwoStageBuildResult {
  stage1: BuildStageResult | null;
  stage2: BuildStageResult;
  totalDurationMs: number;
}

// --- Build manifest types ---

export interface BuildManifestStage {
  imageTag: string;
  imageId: string;
  layers: string[];
  size: number;
  created: string;
  buildArgs: Record<string, string>;
}

export interface BuildManifest {
  version: 1;
  generatedAt: string;
  context: string;
  dockerfile: string;
  stage1: BuildManifestStage | null;
  stage2: BuildManifestStage;
}

export interface VerifyResult {
  match: boolean;
  drifts: DriftEntry[];
}

export interface DriftEntry {
  stage: 1 | 2;
  field: string;
  expected: string;
  actual: string;
}

// --- Two-stage build ---

/**
 * Run a two-stage Docker build.
 *
 * Stage 1 builds the base image (OpenClaw + system packages).
 * Stage 2 builds the final image on top (custom tools + skills).
 */
export async function twoStageBuild(
  client: DockerClient,
  options: TwoStageBuildOptions,
): Promise<TwoStageBuildResult> {
  const totalStart = Date.now();
  let stage1: BuildStageResult | null = null;

  // Stage 1: Base image
  const skipStage1 =
    options.skipStage1 ||
    (options.skipStage1IfExists && (await client.imageExists(options.baseTag, { signal: options.signal })));

  if (!skipStage1) {
    const start = Date.now();
    await client.build(options.context, {
      tag: options.baseTag,
      file: options.dockerfile,
      target: "base",
      buildArgs: options.stage1Args,
      signal: options.signal,
    });
    stage1 = {
      stage: 1,
      success: true,
      imageTag: options.baseTag,
      durationMs: Date.now() - start,
    };
  }

  // Stage 2: Custom layer
  const stage2Start = Date.now();
  await client.build(options.context, {
    tag: options.finalTag,
    file: options.dockerfile,
    target: "custom",
    buildArgs: {
      ...options.stage2Args,
      BASE_IMAGE: options.baseTag,
    },
    signal: options.signal,
  });

  return {
    stage1,
    stage2: {
      stage: 2,
      success: true,
      imageTag: options.finalTag,
      durationMs: Date.now() - stage2Start,
    },
    totalDurationMs: Date.now() - totalStart,
  };
}

// --- Build manifest ---

/**
 * Generate a build manifest from the current images.
 * Records image hashes, layer info, sizes, and build timestamps.
 */
export async function generateManifest(
  client: DockerClient,
  options: {
    context: string;
    baseTag: string;
    finalTag: string;
    dockerfile?: string;
    stage1Args?: Record<string, string>;
    stage2Args?: Record<string, string>;
    stage1Built: boolean;
    signal?: AbortSignal;
  },
): Promise<BuildManifest> {
  let stage1Manifest: BuildManifestStage | null = null;

  if (options.stage1Built || (await client.imageExists(options.baseTag, { signal: options.signal }))) {
    const info = await client.imageInspect(options.baseTag, { signal: options.signal });
    stage1Manifest = inspectToManifestStage(info, options.baseTag, options.stage1Args ?? {});
  }

  const stage2Info = await client.imageInspect(options.finalTag, { signal: options.signal });

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    context: options.context,
    dockerfile: options.dockerfile ?? "Dockerfile",
    stage1: stage1Manifest,
    stage2: inspectToManifestStage(stage2Info, options.finalTag, options.stage2Args ?? {}),
  };
}

function inspectToManifestStage(
  info: ImageInspectResult,
  tag: string,
  buildArgs: Record<string, string>,
): BuildManifestStage {
  return {
    imageTag: tag,
    imageId: info.id,
    layers: info.layers,
    size: info.size,
    created: info.created,
    buildArgs,
  };
}

/** Write a build manifest to disk as JSON. */
export async function writeManifest(
  manifest: BuildManifest,
  outputDir: string,
): Promise<string> {
  const filePath = join(outputDir, "build-manifest.json");
  await writeFile(filePath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  return filePath;
}

/** Read a build manifest from disk. Returns null if not found. */
export async function readManifest(
  dir: string,
): Promise<BuildManifest | null> {
  const filePath = join(dir, "build-manifest.json");
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as BuildManifest;
  } catch {
    return null;
  }
}

// --- Verification ---

/**
 * Compare current images against a saved build manifest.
 * Returns drift entries for any differences found.
 */
export async function verifyAgainstManifest(
  client: DockerClient,
  manifest: BuildManifest,
  options: { signal?: AbortSignal } = {},
): Promise<VerifyResult> {
  const drifts: DriftEntry[] = [];

  // Verify Stage 1 if manifest has it
  if (manifest.stage1) {
    const exists = await client.imageExists(manifest.stage1.imageTag, options);
    if (!exists) {
      drifts.push({
        stage: 1,
        field: "image",
        expected: manifest.stage1.imageTag,
        actual: "(missing)",
      });
    } else {
      const info = await client.imageInspect(manifest.stage1.imageTag, options);
      collectDrifts(drifts, 1, manifest.stage1, info);
    }
  }

  // Verify Stage 2
  const stage2Exists = await client.imageExists(manifest.stage2.imageTag, options);
  if (!stage2Exists) {
    drifts.push({
      stage: 2,
      field: "image",
      expected: manifest.stage2.imageTag,
      actual: "(missing)",
    });
  } else {
    const info = await client.imageInspect(manifest.stage2.imageTag, options);
    collectDrifts(drifts, 2, manifest.stage2, info);
  }

  return { match: drifts.length === 0, drifts };
}

function collectDrifts(
  drifts: DriftEntry[],
  stage: 1 | 2,
  expected: BuildManifestStage,
  actual: ImageInspectResult,
): void {
  if (expected.imageId !== actual.id) {
    drifts.push({
      stage,
      field: "imageId",
      expected: expected.imageId,
      actual: actual.id,
    });
  }

  if (expected.layers.length !== actual.layers.length) {
    drifts.push({
      stage,
      field: "layerCount",
      expected: String(expected.layers.length),
      actual: String(actual.layers.length),
    });
  } else {
    for (let i = 0; i < expected.layers.length; i++) {
      if (expected.layers[i] !== actual.layers[i]) {
        drifts.push({
          stage,
          field: `layer[${i}]`,
          expected: expected.layers[i],
          actual: actual.layers[i],
        });
        break; // Report first layer mismatch only
      }
    }
  }

  if (expected.size !== actual.size) {
    drifts.push({
      stage,
      field: "size",
      expected: String(expected.size),
      actual: String(actual.size),
    });
  }
}

// --- Stage 1 change detection ---

/**
 * Detect whether Stage 1 inputs have changed since the last build.
 * Computes a hash of the Dockerfile and apt package list.
 * Returns true if a rebuild is needed.
 */
export async function detectStage1Changes(
  context: string,
  options: {
    dockerfile?: string;
    stage1Args?: Record<string, string>;
    lastInputHash?: string;
  },
): Promise<{ changed: boolean; inputHash: string }> {
  const hash = createHash("sha256");

  // Hash the Dockerfile content
  const dockerfilePath = join(context, options.dockerfile ?? "Dockerfile");
  try {
    const content = await readFile(dockerfilePath, "utf-8");
    hash.update(content);
  } catch {
    // Dockerfile doesn't exist — always rebuild
    return { changed: true, inputHash: "" };
  }

  // Hash build args (sorted for determinism)
  if (options.stage1Args) {
    const sorted = Object.entries(options.stage1Args).sort(([a], [b]) => a.localeCompare(b));
    hash.update(JSON.stringify(sorted));
  }

  const inputHash = hash.digest("hex");
  const changed = !options.lastInputHash || options.lastInputHash !== inputHash;

  return { changed, inputHash };
}

/**
 * Read the stored Stage 1 input hash from the manifest directory.
 */
export async function readStage1Hash(dir: string): Promise<string | null> {
  const filePath = join(dir, ".stage1-hash");
  try {
    return (await readFile(filePath, "utf-8")).trim();
  } catch {
    return null;
  }
}

/**
 * Write the Stage 1 input hash to the manifest directory.
 */
export async function writeStage1Hash(dir: string, hash: string): Promise<void> {
  await writeFile(join(dir, ".stage1-hash"), hash + "\n", "utf-8");
}

// --- Formatting helpers ---

/** Format milliseconds as human-readable duration. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/** Format bytes as human-readable size. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

/**
 * Build manifest generation and persistence.
 *
 * After a successful build, writes a manifest with image hash, layer info,
 * and stage hashes. Used by cache detection to avoid unnecessary rebuilds.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { manifestPath } from "./cache.js";
import type { BuildManifest, BuildSecurityPosture, ManifestLayer } from "./types.js";

/** Package version used as builder version in manifest. */
const BUILDER_VERSION = "0.1.0";

// ── Manifest Creation ───────────────────────────────────────────────────────

/** Build a manifest object from build outputs. */
export function createManifest(opts: {
  imageId: string;
  imageTag: string;
  imageHash: string;
  layers: readonly ManifestLayer[];
  posture: BuildSecurityPosture;
  stage1Hash: string;
  stage2Hash: string;
}): BuildManifest {
  const totalSizeBytes = opts.layers.reduce((sum, l) => sum + l.sizeBytes, 0);

  return {
    imageId: opts.imageId,
    imageTag: opts.imageTag,
    imageHash: opts.imageHash,
    layers: opts.layers,
    totalSizeBytes,
    posture: opts.posture,
    stage1Hash: opts.stage1Hash,
    stage2Hash: opts.stage2Hash,
    builtAt: new Date().toISOString(),
    builderVersion: BUILDER_VERSION,
  };
}

// ── Manifest I/O ────────────────────────────────────────────────────────────

/** Write a build manifest to disk. */
export async function writeManifest(
  deployDir: string,
  manifest: BuildManifest,
): Promise<void> {
  const path = manifestPath(deployDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}

/** Read a build manifest from disk. Returns null if not found. */
export async function readManifest(
  deployDir: string,
): Promise<BuildManifest | null> {
  try {
    const raw = await readFile(manifestPath(deployDir), "utf-8");
    return JSON.parse(raw) as BuildManifest;
  } catch (e) {
    console.warn(`[docker:manifest] Failed to read build manifest:`, e);
    return null;
  }
}

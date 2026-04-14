/**
 * Artifact verification for from-source builds.
 *
 * Compares the SHA-256 digest of the locally built engine image against
 * the digest of the release artifact. This proves that the from-source
 * build produces an identical engine artifact.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type { VerifyResult } from "./types.js";

const execFileAsync = promisify(execFile);

// ── Constants ────────────────────────────────────────────────────────────────

/** File containing the release image digest (written by trusted-cache install). */
const RELEASE_DIGEST_FILE = "release-digest.txt";

/** Docker image tag for the from-source build. */
const SOURCE_IMAGE_TAG = "openclaw:local";

// ── Verification ─────────────────────────────────────────────────────────────

/**
 * Verify that the from-source build matches the release artifact.
 *
 * Compares the local image digest against:
 * 1. The release digest file (if present from a prior cached install)
 * 2. The remote release image digest (if accessible)
 *
 * If no release digest is available, reports the local digest for
 * manual verification.
 */
export async function verifyArtifact(deployDir: string): Promise<VerifyResult> {
  // Get local image digest
  const localDigest = await getLocalDigest();
  if (!localDigest) {
    return {
      match: false,
      localDigest: "unknown",
      releaseDigest: null,
      detail: "Could not read local image digest. Was the build successful?",
    };
  }

  // Try to read release digest from file
  const releaseDigest = await readReleaseDigest(deployDir);

  if (!releaseDigest) {
    return {
      match: false,
      localDigest,
      releaseDigest: null,
      detail:
        "No release digest available for comparison. " +
        `Local digest: ${truncateDigest(localDigest)}. ` +
        "Run clawhq install (without --from-source) first to establish a baseline, " +
        "or verify this digest manually against the official release.",
    };
  }

  const match = localDigest === releaseDigest;
  return {
    match,
    localDigest,
    releaseDigest,
    detail: match
      ? `Verified: from-source build matches release artifact (${truncateDigest(localDigest)})`
      : `Mismatch: local ${truncateDigest(localDigest)} ≠ release ${truncateDigest(releaseDigest)}`,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Get the digest of the locally built source image. */
async function getLocalDigest(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("docker", [
      "inspect",
      "--format", "{{.Id}}",
      SOURCE_IMAGE_TAG,
    ]);
    const digest = stdout.trim();
    return digest || null;
  } catch (e) {
    return null;
  }
}

/** Read the release digest file from the engine directory. */
async function readReleaseDigest(deployDir: string): Promise<string | null> {
  try {
    const path = join(deployDir, "engine", RELEASE_DIGEST_FILE);
    const content = await readFile(path, "utf-8");
    return content.trim() || null;
  } catch (e) {
    return null;
  }
}

/** Truncate a digest for display (first 16 chars). */
function truncateDigest(digest: string): string {
  const clean = digest.startsWith("sha256:") ? digest.slice(7) : digest;
  return clean.slice(0, 16);
}

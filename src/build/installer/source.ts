/**
 * From-source engine acquisition for `clawhq install --from-source`.
 *
 * Zero-trust path: clone OpenClaw repository, build Docker image from
 * the cloned source, and store the engine artifact in ~/.clawhq/engine/.
 *
 * The build uses `--network=none` to ensure no network calls happen
 * beyond the initial clone.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  INSTALL_BUILD_TIMEOUT_MS,
  INSTALL_CLONE_TIMEOUT_MS,
  OPENCLAW_REPO_URL,
} from "../../config/defaults.js";

import type { SourceBuildOptions, SourceBuildResult } from "./types.js";

const execFileAsync = promisify(execFile);

/** Docker image tag for the from-source build. */
const SOURCE_IMAGE_TAG = "openclaw:local";

// ── Clone Only ──────────────────────────────────────────────────────────────

/**
 * Clone the OpenClaw repository without building.
 *
 * Used by `clawhq install` (default mode) to acquire the engine source.
 * The user then runs `clawhq build` separately to build the Docker image.
 */
export async function cloneEngine(
  options: SourceBuildOptions,
): Promise<SourceBuildResult> {
  const deployDir = resolve(options.deployDir);
  const sourceDir = join(deployDir, "engine", "source");
  const repoUrl = options.repoUrl ?? OPENCLAW_REPO_URL;
  const progress = options.onProgress ?? (() => {});

  progress("clone", `Cloning ${repoUrl}`);

  const cloneResult = await cloneRepo(repoUrl, sourceDir);
  if (!cloneResult.success) {
    return {
      success: false,
      sourceDir,
      error: cloneResult.error,
    };
  }

  if (options.ref) {
    progress("checkout", `Checking out ${options.ref}`);
    const checkoutResult = await checkout(sourceDir, options.ref);
    if (!checkoutResult.success) {
      return {
        success: false,
        sourceDir,
        error: checkoutResult.error,
      };
    }
  }

  return {
    success: true,
    sourceDir,
  };
}

// ── Source Build ─────────────────────────────────────────────────────────────

/**
 * Clone the OpenClaw repository and build the engine from source.
 *
 * Steps:
 * 1. Clone repository to ~/.clawhq/engine/source/
 * 2. Optionally check out a specific ref (tag/branch/commit)
 * 3. Build Docker image with --network=none (no network after clone)
 * 4. Tag as openclaw:local
 * 5. Return image digest for verification
 */
export async function buildFromSource(
  options: SourceBuildOptions,
): Promise<SourceBuildResult> {
  const deployDir = resolve(options.deployDir);
  const sourceDir = join(deployDir, "engine", "source");
  const repoUrl = options.repoUrl ?? OPENCLAW_REPO_URL;
  const progress = options.onProgress ?? (() => {});

  // Step 1: Clone repository
  progress("clone", `Cloning ${repoUrl}`);

  const cloneResult = await cloneRepo(repoUrl, sourceDir);
  if (!cloneResult.success) {
    return {
      success: false,
      sourceDir,
      error: cloneResult.error,
    };
  }

  // Step 2: Check out specific ref if provided
  if (options.ref) {
    progress("checkout", `Checking out ${options.ref}`);
    const checkoutResult = await checkout(sourceDir, options.ref);
    if (!checkoutResult.success) {
      return {
        success: false,
        sourceDir,
        error: checkoutResult.error,
      };
    }
  }

  // Step 3: Build Docker image from source (network disabled)
  progress("build", "Building engine from source (network disabled)");

  const buildResult = await dockerBuildFromSource(sourceDir);
  if (!buildResult.success) {
    return {
      success: false,
      sourceDir,
      error: buildResult.error,
    };
  }

  // Step 4: Get image digest
  progress("digest", "Computing image digest");

  const digest = await getImageDigest(SOURCE_IMAGE_TAG);

  return {
    success: true,
    sourceDir,
    imageId: buildResult.imageId,
    imageDigest: digest,
  };
}

// ── Git Operations ───────────────────────────────────────────────────────────

interface CommandResult {
  success: boolean;
  imageId?: string;
  error?: string;
}

/**
 * Clone a repository to the target directory.
 *
 * If the directory already exists, pulls latest instead.
 */
async function cloneRepo(
  repoUrl: string,
  targetDir: string,
): Promise<CommandResult> {
  try {
    if (existsSync(join(targetDir, ".git"))) {
      // Already cloned — fetch latest
      await execFileAsync("git", ["-C", targetDir, "fetch", "--tags"], {
        timeout: INSTALL_CLONE_TIMEOUT_MS,
      });
      await execFileAsync("git", ["-C", targetDir, "pull", "--ff-only"], {
        timeout: INSTALL_CLONE_TIMEOUT_MS,
      });
      return { success: true };
    }

    await execFileAsync(
      "git",
      ["clone", "--depth", "1", repoUrl, targetDir],
      { timeout: INSTALL_CLONE_TIMEOUT_MS },
    );
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Git clone failed: ${message}` };
  }
}

/** Check out a specific git ref. */
async function checkout(
  sourceDir: string,
  ref: string,
): Promise<CommandResult> {
  try {
    // Fetch the specific ref if using shallow clone
    await execFileAsync(
      "git",
      ["-C", sourceDir, "fetch", "--depth", "1", "origin", ref],
      { timeout: INSTALL_CLONE_TIMEOUT_MS },
    );
    await execFileAsync(
      "git",
      ["-C", sourceDir, "checkout", ref],
      { timeout: 30_000 },
    );
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Git checkout failed for ${ref}: ${message}` };
  }
}

// ── Docker Build ─────────────────────────────────────────────────────────────

/**
 * Build Docker image from cloned source with network disabled.
 *
 * Uses --network=none to satisfy the acceptance criterion that no network
 * calls happen beyond the initial clone.
 */
async function dockerBuildFromSource(sourceDir: string): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "docker",
      [
        "build",
        "--network=none",
        "-t", SOURCE_IMAGE_TAG,
        sourceDir,
      ],
      { timeout: INSTALL_BUILD_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
    );

    // Extract image ID from build output (legacy builder uses stdout, BuildKit uses stderr)
    const imageId = extractImageId(stdout) ?? extractImageId(stderr);
    return { success: true, imageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Docker build from source failed: ${message}`,
    };
  }
}

/** Extract image ID from docker build output. */
function extractImageId(output: string): string | undefined {
  // Docker outputs "Successfully built <id>" or "writing image sha256:<hash>"
  const legacyMatch = /Successfully built ([a-f0-9]+)/.exec(output);
  if (legacyMatch) return legacyMatch[1];

  const buildkitMatch = /writing image sha256:([a-f0-9]+)/.exec(output);
  if (buildkitMatch) return `sha256:${buildkitMatch[1]}`;

  return undefined;
}

/** Get the SHA-256 digest of a Docker image. */
async function getImageDigest(tag: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("docker", [
      "inspect",
      "--format", "{{.Id}}",
      tag,
    ]);
    return stdout.trim() || undefined;
  } catch (e) {
    return undefined;
  }
}

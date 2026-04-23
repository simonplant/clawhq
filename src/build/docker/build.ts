/**
 * Docker build orchestrator for `clawhq build`.
 *
 * Coordinates the two-stage image build:
 * 1. Stage 1: Build openclaw:local from the cloned OpenClaw source repo
 *    (uses OpenClaw's own Dockerfile with configurable apt packages)
 * 2. Stage 2: Build openclaw:custom on top with custom tools + skills
 * 3. Write build manifest
 *
 * docker-compose.yml is emitted by the compile/apply path, not here — build
 * is image-only. The orchestrator wraps Docker CLI commands: Stage 1 uses
 * OpenClaw's own Dockerfile; Stage 2 layers on custom binaries and workspace
 * files.
 */

import { execFile } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { agentImageTag } from "../../config/defaults.js";
import { withDeployLock } from "../../config/lock.js";

import { checkCache, computeStage1Hash, computeStage2Hash } from "./cache.js";
import { generateStage2Dockerfile } from "./dockerfile.js";
import { generateIntegrityManifest } from "./integrity.js";
import { createManifest, writeManifest } from "./manifest.js";
import { DEFAULT_POSTURE } from "./posture.js";
import type { BuildOptions, BuildResult, ManifestLayer, WorkspaceManifest } from "./types.js";

const execFileAsync = promisify(execFile);

// ── Image Tags ──────────────────────────────────────────────────────────────

/** Stage 1 base image — shared across all instances. */
const STAGE1_TAG = "openclaw:local";

/** Default apt packages to bake into the base image. */
const DEFAULT_APT_PACKAGES = "tmux ffmpeg jq ripgrep";

// ── Build Orchestrator ──────────────────────────────────────────────────────

/**
 * Run the two-stage Docker build.
 *
 * Stage 1: Build from the cloned OpenClaw source using its own Dockerfile.
 * Stage 2: Layer custom tools and skills on top.
 * Writes the build manifest on success. The compose file is emitted
 * separately by `clawhq apply`.
 *
 * Serialized under the deploy lock so concurrent `clawhq` invocations
 * (another shell, another session, `clawhq up` auto-build path) don't
 * race on the image outputs. The lock is reentrant-by-pid, so auto-build
 * chains (e.g. `up → build`) don't deadlock.
 */
export async function build(options: BuildOptions): Promise<BuildResult> {
  return withDeployLock(options.deployDir, () => buildImpl(options));
}

async function buildImpl(options: BuildOptions): Promise<BuildResult> {
  const { deployDir, stage1, stage2 } = options;
  const posture = options.posture ?? DEFAULT_POSTURE;

  const engineDir = join(deployDir, "engine");
  const sourceDir = join(deployDir, "engine", "source");
  const stage2Tag = agentImageTag(options.instanceName);

  // Ensure engine directory exists
  await mkdir(engineDir, { recursive: true });

  // Verify OpenClaw source is cloned
  if (!existsSync(join(sourceDir, "Dockerfile"))) {
    return {
      success: false,
      manifest: null,
      cacheHit: { stage1: false, stage2: false },
      error: `OpenClaw source not found at ${sourceDir}. Run: clawhq install`,
    };
  }

  // Check cache
  const cache = await checkCache(deployDir, stage1, stage2);
  const skipStage1 = !cache.stage1Changed && !options.noCache;
  const skipStage2 = !cache.stage2Changed && !options.noCache;

  // Stage 1: Build from OpenClaw source using its own Dockerfile
  if (!skipStage1) {
    const aptPackages = stage1.aptPackages.length > 0
      ? stage1.aptPackages.join(" ")
      : DEFAULT_APT_PACKAGES;

    const result = await dockerBuildFromSource(sourceDir, STAGE1_TAG, aptPackages);
    if (!result.success) {
      return { success: false, manifest: null, cacheHit: { stage1: false, stage2: false }, error: result.error };
    }
  }

  // Stage vendored third-party artifacts (e.g. llm-wiki tarball) into the
  // build context so Dockerfile COPY instructions can reach them.
  await stageVendorFiles(engineDir);

  // Stage workspace files into Docker build context (before Dockerfile generation)
  if (stage2.workspace) {
    await stageWorkspaceFiles(deployDir, engineDir, stage2.workspace);
    const integrityManifest = await generateIntegrityManifest(engineDir, stage2.workspace.immutable);
    await writeFile(
      join(engineDir, "workspace-integrity.json"),
      JSON.stringify(integrityManifest, null, 2),
      "utf-8",
    );
  }

  // Stage 2: Layer custom tools on top
  const stage2Dockerfile = generateStage2Dockerfile(STAGE1_TAG, stage2);
  await writeFile(join(engineDir, "Dockerfile"), stage2Dockerfile, "utf-8");

  if (!skipStage2) {
    const result = await dockerBuild(engineDir, "Dockerfile", stage2Tag);
    if (!result.success) {
      return { success: false, manifest: null, cacheHit: { stage1: skipStage1, stage2: false }, error: result.error };
    }
  }

  // Get image info for manifest
  const imageInfo = await getImageInfo(stage2Tag);

  // Stage market-engine sidecar if source exists in the repo. The compose
  // file (written by `clawhq apply`) references this path; staging must
  // happen here because build is what gets the source into the Docker
  // build context.
  await stageMarketEngine(engineDir);

  // Write build manifest
  const manifest = createManifest({
    imageId: imageInfo.id,
    imageTag: stage2Tag,
    imageHash: imageInfo.hash,
    layers: imageInfo.layers,
    posture,
    stage1Hash: computeStage1Hash(stage1),
    stage2Hash: computeStage2Hash(stage2),
  });

  await writeManifest(deployDir, manifest);

  return {
    success: true,
    manifest,
    cacheHit: { stage1: skipStage1, stage2: skipStage2 },
  };
}

// ── Docker CLI Wrappers ─────────────────────────────────────────────────────

interface DockerBuildResult {
  success: boolean;
  error?: string;
}

/**
 * Build Stage 1 from the cloned OpenClaw source using its own Dockerfile.
 * Passes apt packages via --build-arg OPENCLAW_DOCKER_APT_PACKAGES.
 */
async function dockerBuildFromSource(
  sourceDir: string,
  tag: string,
  aptPackages: string,
): Promise<DockerBuildResult> {
  try {
    await execFileAsync("docker", [
      "build",
      "--build-arg", `OPENCLAW_DOCKER_APT_PACKAGES=${aptPackages}`,
      "-t", tag,
      sourceDir,
    ], { timeout: 600_000, maxBuffer: 10 * 1024 * 1024 });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Stage 1 build from source failed: ${message}` };
  }
}

async function dockerBuild(
  contextDir: string,
  dockerfile: string,
  tag: string,
): Promise<DockerBuildResult> {
  try {
    await execFileAsync("docker", [
      "build",
      "-f", join(contextDir, dockerfile),
      "-t", tag,
      contextDir,
    ], { timeout: 600_000 });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Docker build failed for ${tag}: ${message}` };
  }
}

interface ImageInfo {
  id: string;
  hash: string;
  layers: ManifestLayer[];
}

async function getImageInfo(tag: string): Promise<ImageInfo> {
  try {
    const { stdout } = await execFileAsync("docker", [
      "inspect",
      "--format", "{{.Id}}|{{.Size}}",
      tag,
    ]);

    const [id = "", sizeStr = "0"] = stdout.trim().split("|");
    const hash = id.startsWith("sha256:") ? id.slice(7, 23) : id.slice(0, 16);

    return {
      id,
      hash,
      layers: [
        {
          id: hash,
          stage: "stage2",
          sizeBytes: parseInt(sizeStr, 10) || 0,
          createdAt: new Date().toISOString(),
        },
      ],
    };
  } catch (err) {
    // Do NOT swallow into an "unknown" manifest. A prior version of this
    // function returned `{ id: "unknown", hash: "unknown", layers: [] }` on
    // any `docker inspect` failure, which poisoned the cache: subsequent
    // runs saw a "successful" manifest with bogus identity and could skip
    // rebuilds or trust stale layer hashes. Throw instead so the caller
    // surfaces the real failure and the user knows something is wrong.
    throw new Error(
      `docker inspect failed for image ${tag}: ` +
      (err instanceof Error ? err.message : String(err)),
      { cause: err },
    );
  }
}

// ── Workspace Staging ──────────────────────────────────────────────────────

/**
 * Copy immutable workspace files from the deploy directory into the engine
 * directory (Docker build context) so they can be baked into the image layer.
 */
async function stageWorkspaceFiles(
  deployDir: string,
  engineDir: string,
  manifest: WorkspaceManifest,
): Promise<void> {
  for (const relPath of manifest.immutable) {
    const src = join(deployDir, "workspace", relPath);
    const dst = join(engineDir, "workspace", relPath);
    if (!existsSync(src)) continue;
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(src, dst);
  }
}

/**
 * Stage vendored third-party artifacts (e.g. llm-wiki tarball) into the
 * Docker build context at engine/vendor/ so COPY instructions in the
 * generated Dockerfile can reference them. Source is configs/vendor/
 * relative to the ClawHQ project root — see configs/vendor/README.md.
 *
 * Silently no-ops if configs/vendor/ doesn't exist or is empty; not every
 * build needs vendored artifacts and the Dockerfile generator only emits
 * COPY instructions when a vendored dependency is actually pinned.
 */
async function stageVendorFiles(engineDir: string): Promise<void> {
  const projectRoot = resolve(import.meta.dirname ?? __dirname, "..", "..", "..");
  const sourceDir = join(projectRoot, "configs", "vendor");
  if (!existsSync(sourceDir)) return;

  const destDir = join(engineDir, "vendor");
  await mkdir(destDir, { recursive: true });
  cpSync(sourceDir, destDir, {
    recursive: true,
    filter: (src) => {
      const name = src.split("/").pop() ?? "";
      // Docs aren't consumed by the image — skip to keep the build context small.
      if (name === "README.md") return false;
      return true;
    },
  });
}

/**
 * Stage the market-engine sidecar into engine/market-engine/ for Docker build.
 *
 * Copies src/trading/ to engine/market-engine/src/ so the container's
 * tsconfig.json (which sets rootDir: "src") can compile it. Also copies the
 * self-contained package.json, tsconfig.json, Dockerfile, and .dockerignore.
 * Excludes *.test.ts and golden fixtures.
 */
async function stageMarketEngine(engineDir: string): Promise<void> {
  const projectRoot = resolve(import.meta.dirname ?? __dirname, "..", "..", "..");
  const sourceDir = join(projectRoot, "src", "trading");

  if (!existsSync(join(sourceDir, "Dockerfile"))) return;

  const destDir = join(engineDir, "market-engine");
  await mkdir(destDir, { recursive: true });

  // Top-level files go directly into destDir.
  for (const file of ["Dockerfile", ".dockerignore", "package.json", "tsconfig.json"]) {
    const src = join(sourceDir, file);
    if (existsSync(src)) {
      cpSync(src, join(destDir, file));
    }
  }

  // TypeScript sources go into destDir/src so the container tsconfig (rootDir: src)
  // compiles them without reaching outside the build context.
  const srcDest = join(destDir, "src");
  await mkdir(srcDest, { recursive: true });
  cpSync(sourceDir, srcDest, {
    recursive: true,
    filter: (src) => {
      const name = src.split("/").pop() ?? "";
      // Skip files already staged at the top level.
      if (name === "Dockerfile" || name === ".dockerignore") return false;
      if (name === "package.json" || name === "tsconfig.json") return false;
      if (name === "node_modules" || name === "dist") return false;
      // Don't ship tests or golden fixtures in the container.
      if (name.endsWith(".test.ts")) return false;
      if (src.includes(`${sourceDir}/extract/golden`)) return false;
      return true;
    },
  });
}


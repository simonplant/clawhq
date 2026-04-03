/**
 * Docker build orchestrator for `clawhq build`.
 *
 * Coordinates the two-stage build:
 * 1. Stage 1: Build openclaw:local from the cloned OpenClaw source repo
 *    (uses OpenClaw's own Dockerfile with configurable apt packages)
 * 2. Stage 2: Build openclaw:custom on top with custom tools + skills
 * 3. Generate docker-compose.yml with security posture
 * 4. Write build manifest
 *
 * The orchestrator wraps Docker CLI commands. Stage 1 uses OpenClaw's
 * own Dockerfile; Stage 2 layers on custom binaries and workspace files.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { agentImageTag, agentNetworkName } from "../../config/defaults.js";
import { checkCache, computeStage1Hash, computeStage2Hash } from "./cache.js";
import { generateCompose } from "./compose.js";
import { generateStage2Dockerfile } from "./dockerfile.js";
import { createManifest, writeManifest } from "./manifest.js";
import { DEFAULT_POSTURE, getPostureConfig } from "./posture.js";
import type { BuildOptions, BuildResult, ManifestLayer } from "./types.js";

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
 * Writes docker-compose.yml and build manifest on success.
 */
export async function build(options: BuildOptions): Promise<BuildResult> {
  const { deployDir, stage1, stage2 } = options;
  const posture = options.posture ?? DEFAULT_POSTURE;
  const postureConfig = getPostureConfig(posture);
  const engineDir = join(deployDir, "engine");
  const sourceDir = join(deployDir, "engine", "source");
  const stage2Tag = agentImageTag(options.instanceName);
  const networkName = agentNetworkName(options.instanceName);

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

  // Generate docker-compose.yml
  const compose = generateCompose(stage2Tag, postureConfig, deployDir, networkName);
  await writeFile(
    join(engineDir, "docker-compose.yml"),
    serializeYaml(compose),
    "utf-8",
  );

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
  } catch (e) {
    return {
      id: "unknown",
      hash: "unknown",
      layers: [],
    };
  }
}

// ── YAML Serialization ──────────────────────────────────────────────────────

/**
 * Serialize compose config to YAML-like format.
 *
 * Uses simple serialization rather than a YAML library to avoid
 * adding complexity for a well-known structure.
 */
function serializeYaml(compose: ReturnType<typeof generateCompose>): string {
  const lines: string[] = [];
  const svc = compose.services.openclaw;

  lines.push("services:", "  openclaw:");
  lines.push(`    image: ${svc.image}`);
  lines.push(`    user: "${svc.user}"`);
  lines.push(`    read_only: ${svc.read_only}`);
  lines.push(`    restart: ${svc.restart}`);
  lines.push(`    init: ${svc.init}`);

  lines.push("    command:");
  for (const c of svc.command) lines.push(`      - "${c}"`);

  lines.push("    ports:");
  for (const p of svc.ports) lines.push(`      - "${p}"`);

  lines.push("    environment:");
  for (const [key, val] of Object.entries(svc.environment)) {
    lines.push(`      ${key}: "${val}"`);
  }

  lines.push("    healthcheck:");
  lines.push("      test:");
  for (const t of svc.healthcheck.test) lines.push(`        - "${t}"`);
  lines.push(`      interval: ${svc.healthcheck.interval}`);
  lines.push(`      timeout: ${svc.healthcheck.timeout}`);
  lines.push(`      retries: ${svc.healthcheck.retries}`);
  lines.push(`      start_period: ${svc.healthcheck.start_period}`);

  lines.push("    cap_drop:");
  for (const cap of svc.cap_drop) lines.push(`      - ${cap}`);

  lines.push("    security_opt:");
  for (const opt of svc.security_opt) lines.push(`      - ${opt}`);

  lines.push("    tmpfs:");
  for (const t of svc.tmpfs) lines.push(`      - "${t}"`);

  lines.push("    volumes:");
  for (const v of svc.volumes) lines.push(`      - "${v}"`);

  lines.push("    networks:");
  for (const n of svc.networks) lines.push(`      - ${n}`);

  lines.push("    env_file:");
  for (const e of svc.env_file) lines.push(`      - ${e}`);

  if (svc.secrets && svc.secrets.length > 0) {
    lines.push("    secrets:");
    for (const s of svc.secrets) lines.push(`      - ${s}`);
  }

  if (svc.deploy) {
    lines.push("    deploy:");
    lines.push("      resources:");
    lines.push("        limits:");
    lines.push(`          cpus: "${svc.deploy.resources.limits.cpus}"`);
    lines.push(`          memory: ${svc.deploy.resources.limits.memory}`);
    lines.push(`          pids: ${svc.deploy.resources.limits.pids}`);
  }

  lines.push("", "networks:");
  for (const [name, net] of Object.entries(compose.networks)) {
    lines.push(`  ${name}:`);
    lines.push(`    driver: ${net.driver}`);
    if (net.driver_opts) {
      lines.push("    driver_opts:");
      for (const [key, val] of Object.entries(net.driver_opts)) {
        lines.push(`      ${key}: "${val}"`);
      }
    }
  }

  // Top-level secrets section
  if (compose.secrets) {
    lines.push("", "secrets:");
    for (const [name, secret] of Object.entries(compose.secrets)) {
      lines.push(`  ${name}:`);
      lines.push(`    file: ${secret.file}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

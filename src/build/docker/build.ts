/**
 * Docker build orchestrator for `clawhq build`.
 *
 * Coordinates the two-stage build:
 * 1. Check cache — skip unchanged stages
 * 2. Generate Dockerfiles
 * 3. Build Stage 1 (if changed)
 * 4. Build Stage 2 (if changed)
 * 5. Generate docker-compose.yml with security posture
 * 6. Write build manifest
 *
 * The orchestrator wraps Docker CLI commands. It builds *on top of*
 * OpenClaw's images, never modifying them.
 */

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { agentImageTag, agentNetworkName } from "../../config/defaults.js";
import { checkCache, computeStage1Hash, computeStage2Hash } from "./cache.js";
import { generateCompose } from "./compose.js";
import { generateStage1Dockerfile, generateStage2Dockerfile } from "./dockerfile.js";
import { createManifest, writeManifest } from "./manifest.js";
import { DEFAULT_POSTURE, getPostureConfig } from "./posture.js";
import type { BuildOptions, BuildResult, ManifestLayer } from "./types.js";

const execFileAsync = promisify(execFile);

// ── Image Tags ──────────────────────────────────────────────────────────────

/** Stage 1 base image — shared across all instances. */
const STAGE1_TAG = "openclaw:local";

// ── Build Orchestrator ──────────────────────────────────────────────────────

/**
 * Run the two-stage Docker build.
 *
 * Checks cache first — only rebuilds stages whose inputs changed.
 * Writes Dockerfiles, docker-compose.yml, and build manifest on success.
 */
export async function build(options: BuildOptions): Promise<BuildResult> {
  const { deployDir, stage1, stage2 } = options;
  const posture = options.posture ?? DEFAULT_POSTURE;
  const postureConfig = getPostureConfig(posture);
  const engineDir = join(deployDir, "engine");
  const stage2Tag = agentImageTag(options.instanceName);
  const networkName = agentNetworkName(options.instanceName);

  // Ensure engine directory exists
  await mkdir(engineDir, { recursive: true });

  // Check cache
  const cache = await checkCache(deployDir, stage1, stage2);
  const skipStage1 = !cache.stage1Changed && !options.noCache;
  const skipStage2 = !cache.stage2Changed && !options.noCache;

  // Generate and write Dockerfiles
  const stage1Dockerfile = generateStage1Dockerfile(stage1);
  const stage2Dockerfile = generateStage2Dockerfile(STAGE1_TAG, stage2);

  await writeFile(join(engineDir, "Dockerfile.stage1"), stage1Dockerfile, "utf-8");
  await writeFile(join(engineDir, "Dockerfile"), stage2Dockerfile, "utf-8");

  // Build Stage 1
  if (!skipStage1) {
    const result = await dockerBuild(engineDir, "Dockerfile.stage1", STAGE1_TAG);
    if (!result.success) {
      return { success: false, manifest: null, cacheHit: { stage1: false, stage2: false }, error: result.error };
    }
  }

  // Build Stage 2
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

  lines.push(`version: "${compose.version}"`, "", "services:", "  openclaw:");
  lines.push(`    image: ${svc.image}`);
  lines.push(`    user: "${svc.user}"`);
  lines.push(`    read_only: ${svc.read_only}`);
  lines.push(`    restart: ${svc.restart}`);

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

  lines.push("");
  return lines.join("\n");
}

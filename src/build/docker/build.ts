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
import { cpSync, existsSync } from "node:fs";
import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { agentImageTag, agentNetworkName } from "../../config/defaults.js";

import { checkCache, computeStage1Hash, computeStage2Hash } from "./cache.js";
import { generateCompose } from "./compose.js";
import { generateStage2Dockerfile } from "./dockerfile.js";
import { generateIntegrityManifest } from "./integrity.js";
import { createManifest, writeManifest } from "./manifest.js";
import { DEFAULT_POSTURE, getPostureConfig } from "./posture.js";
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
 * Writes docker-compose.yml and build manifest on success.
 */
export async function build(options: BuildOptions): Promise<BuildResult> {
  const { deployDir, stage1, stage2 } = options;
  const posture = options.posture ?? DEFAULT_POSTURE;
  let postureConfig = getPostureConfig(posture);

  // If posture requests gVisor but runsc isn't installed, strip runtime
  // so the compose file doesn't reference an unavailable runtime
  if (postureConfig.runtime === "runsc") {
    try {
      await execFileAsync("runsc", ["--version"], { timeout: 5000 });
    } catch {
      postureConfig = { ...postureConfig, runtime: undefined };
    }
  }

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

  // Stage market-engine sidecar if source exists in the repo
  await stageMarketEngine(engineDir);

  // Stage clawdius-trading sidecar if source exists in the repo
  await stageClawdiusTrading(engineDir);

  // Generate docker-compose.yml
  // Auto-detect cred-proxy: if init/apply generated the proxy files, enable the sidecar
  const credProxyScriptPath = join(engineDir, "cred-proxy.js");
  const credProxyRoutesPath = join(engineDir, "cred-proxy-routes.json");
  const enableCredProxy = existsSync(credProxyScriptPath) && existsSync(credProxyRoutesPath);

  // Auto-detect market-engine: if the market-engine directory exists with a Dockerfile, enable the sidecar
  const marketEngineDir = join(engineDir, "market-engine");
  const enableMarketEngine = existsSync(join(marketEngineDir, "Dockerfile"));

  // Auto-detect clawdius-trading: same pattern.
  const clawdiusTradingDir = join(engineDir, "clawdius-trading");
  const enableClawdiusTrading = existsSync(
    join(clawdiusTradingDir, "Dockerfile"),
  );

  // Pull access.readOnlyHostMounts from clawhq.yaml so `clawhq build`
  // preserves inbound host-file mounts configured by the user.
  let readOnlyHostMounts: readonly string[] | undefined;
  try {
    const { readFileSync } = await import("node:fs");
    const { parse: yamlParse } = await import("yaml");
    const raw = yamlParse(readFileSync(join(deployDir, "clawhq.yaml"), "utf-8")) as Record<string, unknown>;
    const access = raw.access as Record<string, unknown> | undefined;
    const mounts = access?.readOnlyHostMounts;
    if (Array.isArray(mounts)) {
      readOnlyHostMounts = mounts.filter((m): m is string => typeof m === "string");
    }
  } catch { /* no config or parse error — no mounts */ }

  const compose = generateCompose(stage2Tag, postureConfig, deployDir, networkName, {
    enableCredProxy,
    credProxyScriptPath,
    credProxyRoutesPath,
    workspaceManifest: stage2.workspace,
    enableMarketEngine,
    marketEngineDir,
    enableClawdiusTrading,
    clawdiusTradingDir,
    readOnlyHostMounts,
  });
  const composePath = join(engineDir, "docker-compose.yml");
  await writeFile(composePath, serializeYaml(compose), "utf-8");
  await chmod(composePath, 0o600);

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
  } catch {
    return {
      id: "unknown",
      hash: "unknown",
      layers: [],
    };
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
 * Looks for src/market-engine/ relative to the ClawHQ project root.
 * Copies the entire Python project (excluding __pycache__, .egg-info, .pytest_cache)
 * into the engine directory so docker-compose can build it as a sidecar.
 */
async function stageMarketEngine(engineDir: string): Promise<void> {
  // Resolve project root: this file is at src/build/docker/build.ts → 3 levels up
  const projectRoot = resolve(import.meta.dirname ?? __dirname, "..", "..", "..");
  const sourceDir = join(projectRoot, "src", "market-engine");

  if (!existsSync(join(sourceDir, "Dockerfile"))) return;

  const destDir = join(engineDir, "market-engine");
  await mkdir(destDir, { recursive: true });

  cpSync(sourceDir, destDir, {
    recursive: true,
    filter: (src) => {
      // Skip build artifacts, caches, and dev-only files
      const name = src.split("/").pop() ?? "";
      if (name === "__pycache__" || name === ".pytest_cache") return false;
      if (name.endsWith(".egg-info")) return false;
      if (name === ".gitignore") return false;
      if (name === "tests") return false; // Don't ship tests in the container
      return true;
    },
  });
}

/**
 * Stage the clawdius-trading sidecar into engine/clawdius-trading/ for Docker build.
 *
 * Copies src/trading/ to engine/clawdius-trading/src/ so the container's
 * tsconfig.json (which sets rootDir: "src") can compile it. Also copies the
 * self-contained package.json, tsconfig.json, Dockerfile, and .dockerignore.
 * Excludes *.test.ts and golden fixtures.
 */
async function stageClawdiusTrading(engineDir: string): Promise<void> {
  const projectRoot = resolve(import.meta.dirname ?? __dirname, "..", "..", "..");
  const sourceDir = join(projectRoot, "src", "trading");

  if (!existsSync(join(sourceDir, "Dockerfile"))) return;

  const destDir = join(engineDir, "clawdius-trading");
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

// ── YAML Serialization ──────────────────────────────────────────────────────

/**
 * Serialize compose config to YAML-like format.
 *
 * Uses simple serialization rather than a YAML library to avoid
 * adding complexity for a well-known structure.
 */
export function serializeYaml(compose: ReturnType<typeof generateCompose>): string {
  const lines: string[] = [];
  const svc = compose.services.openclaw;

  // Note: 'version' is obsolete in Docker Compose v2+ and produces a warning
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

  lines.push("    extra_hosts:");
  for (const h of svc.extra_hosts) lines.push(`      - "${h}"`);

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

  if (svc.runtime) {
    lines.push(`    runtime: ${svc.runtime}`);
  }

  if (svc.deploy) {
    lines.push("    deploy:");
    lines.push("      resources:");
    lines.push("        limits:");
    lines.push(`          cpus: "${svc.deploy.resources.limits.cpus}"`);
    lines.push(`          memory: ${svc.deploy.resources.limits.memory}`);
    lines.push(`          pids: ${svc.deploy.resources.limits.pids}`);
  }

  // Credential proxy sidecar
  if (compose.services["cred-proxy"]) {
    const cp = compose.services["cred-proxy"];
    lines.push("", "  cred-proxy:");
    lines.push(`    image: ${cp.image}`);
    lines.push(`    user: "${cp.user}"`);
    lines.push(`    read_only: ${cp.read_only}`);
    lines.push(`    restart: ${cp.restart}`);
    lines.push("    cap_drop:");
    for (const cap of cp.cap_drop) lines.push(`      - ${cap}`);
    lines.push("    security_opt:");
    for (const opt of cp.security_opt) lines.push(`      - ${opt}`);
    lines.push("    command:");
    for (const c of cp.command) lines.push(`      - "${c}"`);
    lines.push("    volumes:");
    for (const v of cp.volumes) lines.push(`      - "${v}"`);
    lines.push("    networks:");
    for (const n of cp.networks) lines.push(`      - ${n}`);
    lines.push("    env_file:");
    for (const e of cp.env_file) lines.push(`      - ${e}`);
    lines.push("    tmpfs:");
    for (const t of cp.tmpfs) lines.push(`      - "${t}"`);
    lines.push("    healthcheck:");
    lines.push("      test:");
    for (const t of cp.healthcheck.test) {
      // Use single-quoted YAML scalar when value contains double quotes
      if (t.includes('"')) {
        lines.push(`        - '${t}'`);
      } else {
        lines.push(`        - "${t}"`);
      }
    }
    lines.push(`      interval: ${cp.healthcheck.interval}`);
    lines.push(`      timeout: ${cp.healthcheck.timeout}`);
    lines.push(`      retries: ${cp.healthcheck.retries}`);
  }

  // Market-engine sidecar
  if (compose.services["market-engine"]) {
    const me = compose.services["market-engine"];
    lines.push("", "  market-engine:");
    lines.push("    build:");
    lines.push(`      context: ${me.build.context}`);
    lines.push(`      dockerfile: ${me.build.dockerfile}`);
    lines.push(`    user: "${me.user}"`);
    lines.push(`    read_only: ${me.read_only}`);
    lines.push(`    restart: ${me.restart}`);
    lines.push("    cap_drop:");
    for (const cap of me.cap_drop) lines.push(`      - ${cap}`);
    lines.push("    security_opt:");
    for (const opt of me.security_opt) lines.push(`      - ${opt}`);
    lines.push("    volumes:");
    for (const v of me.volumes) lines.push(`      - "${v}"`);
    lines.push("    networks:");
    for (const n of me.networks) lines.push(`      - ${n}`);
    lines.push("    env_file:");
    for (const e of me.env_file) lines.push(`      - ${e}`);
    lines.push("    environment:");
    for (const [key, val] of Object.entries(me.environment)) {
      lines.push(`      ${key}: "${val}"`);
    }
    lines.push("    tmpfs:");
    for (const t of me.tmpfs) lines.push(`      - "${t}"`);
    if (me.depends_on && Object.keys(me.depends_on).length > 0) {
      lines.push("    depends_on:");
      for (const [svc, cond] of Object.entries(me.depends_on)) {
        lines.push(`      ${svc}:`);
        lines.push(`        condition: ${(cond as { condition: string }).condition}`);
      }
    }
    lines.push("    healthcheck:");
    lines.push("      test:");
    for (const t of me.healthcheck.test) {
      if (t.includes('"')) {
        lines.push(`        - '${t}'`);
      } else {
        lines.push(`        - "${t}"`);
      }
    }
    lines.push(`      interval: ${me.healthcheck.interval}`);
    lines.push(`      timeout: ${me.healthcheck.timeout}`);
    lines.push(`      retries: ${me.healthcheck.retries}`);
  }

  // Clawdius-trading sidecar
  if (compose.services["clawdius-trading"]) {
    const ct = compose.services["clawdius-trading"];
    lines.push("", "  clawdius-trading:");
    lines.push("    build:");
    lines.push(`      context: ${ct.build.context}`);
    lines.push(`      dockerfile: ${ct.build.dockerfile}`);
    lines.push(`    user: "${ct.user}"`);
    lines.push(`    read_only: ${ct.read_only}`);
    lines.push(`    restart: ${ct.restart}`);
    lines.push("    cap_drop:");
    for (const cap of ct.cap_drop) lines.push(`      - ${cap}`);
    lines.push("    security_opt:");
    for (const opt of ct.security_opt) lines.push(`      - ${opt}`);
    lines.push("    volumes:");
    for (const v of ct.volumes) lines.push(`      - "${v}"`);
    lines.push("    networks:");
    for (const n of ct.networks) lines.push(`      - ${n}`);
    lines.push("    env_file:");
    for (const e of ct.env_file) lines.push(`      - ${e}`);
    lines.push("    environment:");
    for (const [key, val] of Object.entries(ct.environment)) {
      lines.push(`      ${key}: "${val}"`);
    }
    lines.push("    tmpfs:");
    for (const t of ct.tmpfs) lines.push(`      - "${t}"`);
    if (ct.depends_on && Object.keys(ct.depends_on).length > 0) {
      lines.push("    depends_on:");
      for (const [svc, cond] of Object.entries(ct.depends_on)) {
        lines.push(`      ${svc}:`);
        lines.push(`        condition: ${(cond as { condition: string }).condition}`);
      }
    }
    lines.push("    healthcheck:");
    lines.push("      test:");
    for (const t of ct.healthcheck.test) {
      if (t.includes('"')) {
        lines.push(`        - '${t}'`);
      } else {
        lines.push(`        - "${t}"`);
      }
    }
    lines.push(`      interval: ${ct.healthcheck.interval}`);
    lines.push(`      timeout: ${ct.healthcheck.timeout}`);
    lines.push(`      retries: ${ct.healthcheck.retries}`);
  }

  // Tailscale sidecar
  if (compose.services.tailscale) {
    const ts = compose.services.tailscale;
    lines.push("", "  tailscale:");
    lines.push(`    image: ${ts.image}`);
    lines.push(`    hostname: ${ts.hostname}`);
    lines.push(`    restart: ${ts.restart}`);
    lines.push("    cap_drop:");
    for (const cap of ts.cap_drop) lines.push(`      - ${cap}`);
    lines.push("    volumes:");
    for (const v of ts.volumes) lines.push(`      - "${v}"`);
    lines.push("    networks:");
    for (const n of ts.networks) lines.push(`      - ${n}`);
    lines.push("    environment:");
    for (const [key, val] of Object.entries(ts.environment)) {
      lines.push(`      ${key}: "${val}"`);
    }
    lines.push("    healthcheck:");
    lines.push("      test:");
    for (const t of ts.healthcheck.test) lines.push(`        - "${t}"`);
    lines.push(`      interval: ${ts.healthcheck.interval}`);
    lines.push(`      timeout: ${ts.healthcheck.timeout}`);
    lines.push(`      retries: ${ts.healthcheck.retries}`);
  }

  lines.push("", "networks:");
  for (const [name, net] of Object.entries(compose.networks)) {
    lines.push(`  ${name}:`);
    if ("external" in net && (net as Record<string, unknown>).external) {
      lines.push("    external: true");
    } else {
      lines.push(`    driver: ${net.driver}`);
      if (net.driver_opts) {
        lines.push("    driver_opts:");
        for (const [key, val] of Object.entries(net.driver_opts)) {
          lines.push(`      ${key}: "${val}"`);
        }
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

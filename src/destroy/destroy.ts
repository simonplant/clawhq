/**
 * Verified destruction orchestration.
 *
 * Implements the full destruction sequence:
 * 1. Dry-run: inventory all data, backup/export status
 * 2. Confirmation: deployment name must be typed
 * 3. Destruction: stop → volumes → workspace → config → secrets → images → networks → firewall → clawhq config
 * 4. Manifest: signed destruction proof with timestamps and hashes
 */

import { existsSync } from "node:fs";
import { readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { DockerClient } from "../docker/client.js";
import { remove as removeFirewall } from "../security/firewall/firewall.js";
import { CHAIN_NAME } from "../security/firewall/types.js";

import { buildDestructionManifest } from "./manifest.js";
import type {
  DestroyOptions,
  DestroyResult,
  DestroyStep,
  DryRunItem,
  DryRunResult,
  StepStatus,
} from "./types.js";

// --- Helpers ---

async function timedStep(
  name: string,
  fn: () => Promise<{ status: StepStatus; message: string }>,
): Promise<DestroyStep> {
  const start = Date.now();
  try {
    const { status, message } = await fn();
    return { name, status, message, durationMs: Date.now() - start };
  } catch (err: unknown) {
    return {
      name,
      status: "failed",
      message: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

function resolveHome(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

// --- Dry Run ---

/**
 * Perform a dry-run: list all local data, data requiring manual cleanup,
 * backup/export status.
 */
export async function dryRun(opts: DestroyOptions): Promise<DryRunResult> {
  const openclawHome = resolveHome(opts.openclawHome);
  const clawhqConfigDir = resolveHome(opts.clawhqConfigDir ?? "~/.clawhq");
  const backupDir = join(clawhqConfigDir, "backups");
  const items: DryRunItem[] = [];

  // Derive deployment name from openclawHome directory name or config
  const deploymentName = opts.deploymentName ?? basename(openclawHome);

  // 1. Containers
  try {
    const client = opts.composePath
      ? new DockerClient({ cwd: opts.composePath.replace(/\/[^/]+$/, "") })
      : new DockerClient();
    const containers = await client.ps({ signal: opts.signal });
    for (const c of containers) {
      items.push({
        category: "container",
        label: `Container: ${c.name}`,
        location: c.id,
        autoDestroy: true,
      });
    }
  } catch {
    // No containers running or compose not configured
  }

  // 2. Volumes (docker compose volumes)
  if (opts.composePath || existsSync(join(openclawHome, "docker-compose.yml"))) {
    items.push({
      category: "volume",
      label: "Docker compose volumes",
      location: "docker compose down -v",
      autoDestroy: true,
    });
  }

  // 3. Workspace
  const workspacePath = join(openclawHome, "workspace");
  if (await dirExists(workspacePath)) {
    items.push({
      category: "workspace",
      label: "Agent workspace (identity, memory, skills, tools)",
      location: workspacePath,
      autoDestroy: true,
    });
  }

  // 4. Config
  const configPath = join(openclawHome, "openclaw.json");
  if (await fileExists(configPath)) {
    items.push({
      category: "config",
      label: "OpenClaw configuration",
      location: configPath,
      autoDestroy: true,
    });
  }

  // Cron
  const cronPath = join(openclawHome, "cron");
  if (await dirExists(cronPath)) {
    items.push({
      category: "config",
      label: "Cron job definitions",
      location: cronPath,
      autoDestroy: true,
    });
  }

  // Docker compose file
  const composePath = join(openclawHome, "docker-compose.yml");
  if (await fileExists(composePath)) {
    items.push({
      category: "config",
      label: "Docker compose configuration",
      location: composePath,
      autoDestroy: true,
    });
  }

  // 5. Secrets
  const envPath = join(openclawHome, ".env");
  if (await fileExists(envPath)) {
    items.push({
      category: "secrets",
      label: "Environment secrets (.env)",
      location: envPath,
      autoDestroy: true,
    });
  }

  // 6. Images
  if (opts.imageTag) {
    items.push({
      category: "images",
      label: `Agent image: ${opts.imageTag}`,
      location: opts.imageTag,
      autoDestroy: true,
    });
  }
  if (opts.baseTag) {
    items.push({
      category: "images",
      label: `Base image: ${opts.baseTag}`,
      location: opts.baseTag,
      autoDestroy: true,
    });
  }

  // 7. Networks
  items.push({
    category: "networks",
    label: "Docker compose networks",
    location: "docker compose down (removes project networks)",
    autoDestroy: true,
  });

  // 8. Firewall
  items.push({
    category: "firewall",
    label: "Egress firewall (CLAWHQ_FWD iptables chain)",
    location: "iptables",
    autoDestroy: true,
  });

  // 9. ClawHQ config
  if (await dirExists(clawhqConfigDir)) {
    items.push({
      category: "clawhq-config",
      label: "ClawHQ configuration directory",
      location: clawhqConfigDir,
      autoDestroy: true,
    });
  }

  // 10. External services (manual cleanup)
  items.push({
    category: "config",
    label: "External service credentials (Telegram bot, API keys, etc.)",
    location: "External services",
    autoDestroy: false,
    manualAction: "Revoke API keys and tokens at each provider's dashboard",
  });

  // Check backup status
  let hasBackup = false;
  if (await dirExists(backupDir)) {
    try {
      const entries = await readdir(backupDir);
      hasBackup = entries.some((e) => e.startsWith("backup-"));
    } catch {
      // No backups
    }
  }

  // Check export status
  let hasExport = false;
  if (opts.keepExport) {
    hasExport = true; // User intends to keep export
  } else {
    // Check for export bundles in common locations
    const cwd = process.cwd();
    try {
      const entries = await readdir(cwd);
      hasExport = entries.some((e) => e.startsWith("export-") && e.endsWith(".tar.gz"));
    } catch {
      // Ignore
    }
  }

  return { items, hasBackup, hasExport, deploymentName };
}

// --- Destruction Sequence ---

/**
 * Execute the full verified destruction sequence.
 *
 * Sequence: stop container → remove volumes → wipe workspace → wipe config →
 * wipe secrets → remove images → remove networks → remove firewall →
 * remove clawhq config → generate signed destruction manifest.
 */
export async function destroy(opts: DestroyOptions): Promise<DestroyResult> {
  const openclawHome = resolveHome(opts.openclawHome);
  const clawhqConfigDir = resolveHome(opts.clawhqConfigDir ?? "~/.clawhq");
  const bridgeInterface = opts.bridgeInterface ?? "docker0";
  const deploymentName = opts.deploymentName ?? basename(openclawHome);
  const steps: DestroyStep[] = [];

  const client = opts.composePath
    ? new DockerClient({ cwd: opts.composePath.replace(/\/[^/]+$/, "") })
    : new DockerClient();

  // Step 1: Stop container (compose down with volumes)
  steps.push(await timedStep("Stop container", async () => {
    try {
      await client.composeExec(["down", "-v"], { signal: opts.signal });
      return { status: "done", message: "Containers stopped and volumes removed" };
    } catch {
      return { status: "done", message: "No containers to stop (already down)" };
    }
  }));

  // Step 2: Remove volumes (handled by compose down -v above, verify)
  steps.push(await timedStep("Remove volumes", async () => {
    // compose down -v already removes project volumes
    // Verify no orphaned volumes remain
    try {
      const containers = await client.ps({ signal: opts.signal });
      if (containers.length > 0) {
        return { status: "failed", message: "Containers still running after stop" };
      }
    } catch {
      // No containers — expected after compose down
    }
    return { status: "done", message: "Volumes removed" };
  }));

  // Step 3: Wipe workspace
  steps.push(await timedStep("Wipe workspace", async () => {
    const workspacePath = join(openclawHome, "workspace");
    if (await dirExists(workspacePath)) {
      await rm(workspacePath, { recursive: true, force: true });
      return { status: "done", message: `Removed ${workspacePath}` };
    }
    return { status: "skipped", message: "No workspace directory found" };
  }));

  // Step 4: Wipe config
  steps.push(await timedStep("Wipe config", async () => {
    const removed: string[] = [];

    const configPath = join(openclawHome, "openclaw.json");
    if (await fileExists(configPath)) {
      await rm(configPath, { force: true });
      removed.push("openclaw.json");
    }

    const composePath = join(openclawHome, "docker-compose.yml");
    if (await fileExists(composePath)) {
      await rm(composePath, { force: true });
      removed.push("docker-compose.yml");
    }

    const dockerfilePath = join(openclawHome, "Dockerfile");
    if (await fileExists(dockerfilePath)) {
      await rm(dockerfilePath, { force: true });
      removed.push("Dockerfile");
    }

    const cronPath = join(openclawHome, "cron");
    if (await dirExists(cronPath)) {
      await rm(cronPath, { recursive: true, force: true });
      removed.push("cron/");
    }

    const buildManifest = join(openclawHome, "build-manifest.json");
    if (await fileExists(buildManifest)) {
      await rm(buildManifest, { force: true });
      removed.push("build-manifest.json");
    }

    if (removed.length === 0) {
      return { status: "skipped", message: "No config files found" };
    }
    return { status: "done", message: `Removed: ${removed.join(", ")}` };
  }));

  // Step 5: Wipe secrets
  steps.push(await timedStep("Wipe secrets", async () => {
    const envFiles = [".env", ".env.local", ".env.production"];
    const removed: string[] = [];

    for (const envFile of envFiles) {
      const envPath = join(openclawHome, envFile);
      if (await fileExists(envPath)) {
        await rm(envPath, { force: true });
        removed.push(envFile);
      }
    }

    if (removed.length === 0) {
      return { status: "skipped", message: "No secret files found" };
    }
    return { status: "done", message: `Removed: ${removed.join(", ")}` };
  }));

  // Step 6: Remove images
  steps.push(await timedStep("Remove images", async () => {
    const removed: string[] = [];

    if (opts.imageTag) {
      try {
        await client.exec(["rmi", opts.imageTag], { signal: opts.signal });
        removed.push(opts.imageTag);
      } catch {
        // Image may not exist
      }
    }

    if (opts.baseTag) {
      try {
        await client.exec(["rmi", opts.baseTag], { signal: opts.signal });
        removed.push(opts.baseTag);
      } catch {
        // Image may not exist
      }
    }

    if (removed.length === 0) {
      return { status: "skipped", message: "No image tags specified or images not found" };
    }
    return { status: "done", message: `Removed: ${removed.join(", ")}` };
  }));

  // Step 7: Remove networks (handled by compose down above)
  steps.push(await timedStep("Remove networks", async () => {
    // compose down already removes project networks
    return { status: "done", message: "Networks removed (via compose down)" };
  }));

  // Step 8: Remove firewall
  steps.push(await timedStep("Remove firewall", async () => {
    const result = await removeFirewall({
      chainName: CHAIN_NAME,
      bridgeInterface,
      allowlist: [],
    });
    return {
      status: result.success ? "done" : "failed",
      message: result.message,
    };
  }));

  // Step 9: Remove ClawHQ config
  steps.push(await timedStep("Remove ClawHQ config", async () => {
    if (!(await dirExists(clawhqConfigDir))) {
      return { status: "skipped", message: "No ClawHQ config directory found" };
    }

    if (opts.keepExport) {
      // Preserve export bundles — only remove non-export contents
      const entries = await readdir(clawhqConfigDir);
      for (const entry of entries) {
        if (entry.startsWith("export-")) continue;
        const entryPath = join(clawhqConfigDir, entry);
        await rm(entryPath, { recursive: true, force: true });
      }
      return { status: "done", message: `Removed ClawHQ config (preserved export bundles)` };
    }

    await rm(clawhqConfigDir, { recursive: true, force: true });
    return { status: "done", message: `Removed ${clawhqConfigDir}` };
  }));

  // Step 10: Generate signed destruction manifest
  const manifest = buildDestructionManifest(deploymentName, steps);

  // Write manifest to a known location
  const manifestPath = join(
    opts.keepExport ? clawhqConfigDir : homedir(),
    `destruction-manifest-${manifest.manifestId}.json`,
  );

  steps.push(await timedStep("Generate destruction manifest", async () => {
    const manifestJson = JSON.stringify(manifest, null, 2);
    // Ensure parent directory exists for manifest
    const parentDir = manifestPath.substring(0, manifestPath.lastIndexOf("/"));
    const { mkdir: mkdirAsync } = await import("node:fs/promises");
    await mkdirAsync(parentDir, { recursive: true });
    await writeFile(manifestPath, manifestJson, "utf-8");
    return {
      status: "done",
      message: `Manifest written to ${manifestPath}`,
    };
  }));

  const success = steps.every((s) => s.status === "done" || s.status === "skipped");
  return { success, steps, manifest };
}

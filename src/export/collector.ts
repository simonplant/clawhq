/**
 * Bundle file collector for portable export.
 *
 * Collects identity files, memory archive (all tiers), workspace snapshot,
 * config (secrets redacted), integration manifest, interaction history,
 * and build manifest from the OpenClaw home directory.
 */

import { createHash, randomBytes } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import type { ExportFileEntry } from "./types.js";

/** Paths relative to openclawHome that form the full export bundle. */
const FULL_EXPORT_PATHS = [
  // Identity files
  "workspace/identity",
  // Memory archive (all tiers)
  "workspace/memory",
  // Workspace snapshot (skills, tools, etc.)
  "workspace",
  // Config (secrets will be redacted by caller)
  "openclaw.json",
  // Cron definitions and history
  "cron",
  // Docker compose (deployment config)
  "docker-compose.yml",
  // Build manifest (if present)
  "build-manifest.json",
];

/** Paths for --no-memory mode: identity + config only. */
const IDENTITY_CONFIG_PATHS = [
  "workspace/identity",
  "openclaw.json",
  "docker-compose.yml",
  "cron",
];

/** Files that contain secrets and must be excluded from export. */
const SECRET_FILES = new Set([".env", ".env.local", ".env.production"]);

/**
 * Compute SHA-256 hash of content.
 */
export function hashContent(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Generate a unique export ID: timestamp + random suffix.
 */
export function generateExportId(): string {
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const suffix = randomBytes(4).toString("hex");
  return `export-${ts}-${suffix}`;
}

/**
 * Recursively collect all files under a directory.
 */
async function collectFilesRecursive(dir: string): Promise<string[]> {
  const results: string[] = [];

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const s = await stat(fullPath);
    if (s.isDirectory()) {
      const sub = await collectFilesRecursive(fullPath);
      results.push(...sub);
    } else if (s.isFile()) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Read config file and redact secret values.
 *
 * Replaces values for keys containing "key", "secret", "token",
 * "password", or "credential" with "[REDACTED]".
 */
export async function readConfigRedacted(
  configPath: string,
): Promise<string> {
  const content = await readFile(configPath, "utf-8");

  try {
    const config = JSON.parse(content) as Record<string, unknown>;
    redactSecrets(config);
    return JSON.stringify(config, null, 2);
  } catch {
    // If not valid JSON, return as-is (shouldn't happen for openclaw.json)
    return content;
  }
}

const SECRET_KEY_PATTERN = /key|secret|token|password|credential|apikey/i;

function redactSecrets(obj: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" && SECRET_KEY_PATTERN.test(key)) {
      obj[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      redactSecrets(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "object" && item !== null) {
          redactSecrets(item as Record<string, unknown>);
        }
      }
    }
  }
}

/**
 * Collect files for export and write redacted copies to the staging directory.
 *
 * Returns file entries with paths relative to the staging directory.
 */
export async function collectExportFiles(
  openclawHome: string,
  stagingDir: string,
  noMemory: boolean,
): Promise<ExportFileEntry[]> {
  const basePaths = noMemory ? IDENTITY_CONFIG_PATHS : FULL_EXPORT_PATHS;
  const entries: ExportFileEntry[] = [];
  const seen = new Set<string>();

  for (const relPath of basePaths) {
    const fullPath = join(openclawHome, relPath);

    let s;
    try {
      s = await stat(fullPath);
    } catch {
      continue;
    }

    if (s.isFile()) {
      const fileRelPath = relPath;
      if (seen.has(fileRelPath) || SECRET_FILES.has(fileRelPath)) continue;
      seen.add(fileRelPath);

      const entry = await collectSingleFile(
        fullPath,
        fileRelPath,
        stagingDir,
        openclawHome,
      );
      if (entry) entries.push(entry);
    } else if (s.isDirectory()) {
      const files = await collectFilesRecursive(fullPath);
      for (const file of files) {
        const fileRelPath = relative(openclawHome, file);
        const basename = file.split("/").pop() ?? "";

        if (seen.has(fileRelPath) || SECRET_FILES.has(basename)) continue;
        seen.add(fileRelPath);

        const entry = await collectSingleFile(
          file,
          fileRelPath,
          stagingDir,
          openclawHome,
        );
        if (entry) entries.push(entry);
      }
    }
  }

  return entries;
}

async function collectSingleFile(
  fullPath: string,
  relPath: string,
  stagingDir: string,
  openclawHome: string,
): Promise<ExportFileEntry | null> {
  const targetPath = join(stagingDir, relPath);

  // Ensure target directory exists
  const targetDir = targetPath.substring(0, targetPath.lastIndexOf("/"));
  const { mkdir } = await import("node:fs/promises");
  await mkdir(targetDir, { recursive: true });

  // Redact secrets from config files
  let content: Buffer;
  if (relPath === "openclaw.json") {
    const redacted = await readConfigRedacted(join(openclawHome, relPath));
    content = Buffer.from(redacted, "utf-8");
  } else {
    content = await readFile(fullPath);
  }

  await writeFile(targetPath, content);

  const hash = hashContent(content);
  return {
    path: relPath,
    size: content.length,
    hash,
  };
}

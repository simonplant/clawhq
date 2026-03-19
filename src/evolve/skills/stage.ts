/**
 * Skill staging — copies skill files from source to a staging area
 * for vetting before activation.
 *
 * Supports local directory sources. Skills are staged to
 * `workspace/skills/<name>/` with status "staged" in the manifest.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { cp, mkdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import type { SkillManifestEntry } from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum skill directory size in bytes (10 MB). */
const MAX_SKILL_SIZE_BYTES = 10 * 1024 * 1024;

/** Allowed file extensions inside a skill directory. */
const ALLOWED_EXTENSIONS = new Set([
  ".sh",
  ".bash",
  ".py",
  ".js",
  ".ts",
  ".json",
  ".yaml",
  ".yml",
  ".md",
  ".txt",
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Recursively compute total size of a directory. */
function dirSize(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += dirSize(full);
    } else {
      total += statSync(full).size;
    }
  }
  return total;
}

/** List all files in a directory recursively (relative paths). */
function listFiles(dir: string, prefix = ""): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...listFiles(join(dir, entry.name), rel));
    } else {
      files.push(rel);
    }
  }
  return files;
}

// ── Stage ────────────────────────────────────────────────────────────────────

export interface StageResult {
  readonly success: boolean;
  readonly skillName: string;
  readonly stagingDir: string;
  readonly files: readonly string[];
  readonly error?: string;
}

/**
 * Stage a skill from a local directory source.
 *
 * Validates the source, checks size limits and file extensions,
 * then copies to the staging area under workspace/skills/.
 */
export async function stageSkill(
  source: string,
  deployDir: string,
): Promise<StageResult> {
  const resolved = resolve(source);

  // Validate source exists and is a directory
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    return {
      success: false,
      skillName: basename(resolved),
      stagingDir: "",
      files: [],
      error: `Source is not a directory: ${resolved}`,
    };
  }

  const skillName = basename(resolved);

  // Validate skill name
  if (!/^[a-z][a-z0-9-]*$/.test(skillName)) {
    return {
      success: false,
      skillName,
      stagingDir: "",
      files: [],
      error: `Invalid skill name "${skillName}". Must be lowercase alphanumeric with hyphens, starting with a letter.`,
    };
  }

  // Check size limit
  const size = dirSize(resolved);
  if (size > MAX_SKILL_SIZE_BYTES) {
    return {
      success: false,
      skillName,
      stagingDir: "",
      files: [],
      error: `Skill "${skillName}" exceeds size limit (${(size / 1024 / 1024).toFixed(1)} MB > 10 MB).`,
    };
  }

  // List and validate files
  const files = listFiles(resolved);
  if (files.length === 0) {
    return {
      success: false,
      skillName,
      stagingDir: "",
      files: [],
      error: `Skill directory "${skillName}" is empty.`,
    };
  }

  const badFiles = files.filter((f) => {
    const ext = f.includes(".") ? `.${f.split(".").pop()}` : "";
    return ext !== "" && !ALLOWED_EXTENSIONS.has(ext);
  });
  if (badFiles.length > 0) {
    return {
      success: false,
      skillName,
      stagingDir: "",
      files: [],
      error: `Disallowed file types in skill: ${badFiles.join(", ")}`,
    };
  }

  // Copy to staging area
  const skillsDir = join(deployDir, "workspace", "skills");
  const stagingDir = join(skillsDir, skillName);

  await mkdir(skillsDir, { recursive: true });
  await cp(resolved, stagingDir, { recursive: true });

  return { success: true, skillName, stagingDir, files };
}

/**
 * Read all files in a staged skill directory and return their contents.
 * Used by the vetting engine to scan for threats.
 */
export async function readStagedFiles(
  stagingDir: string,
): Promise<Array<{ file: string; content: string }>> {
  const files = listFiles(stagingDir);
  const results: Array<{ file: string; content: string }> = [];

  for (const file of files) {
    // Skip binary-looking files and manifests
    if (file === ".skill-manifest.json") continue;
    try {
      const content = await readFile(join(stagingDir, file), "utf-8");
      results.push({ file, content });
    } catch {
      // Skip unreadable files (binary, etc.)
    }
  }

  return results;
}

/**
 * Create a manifest entry for a newly staged skill.
 */
export function createStagedEntry(
  skillName: string,
  source: string,
  snapshotId?: string,
): SkillManifestEntry {
  return {
    name: skillName,
    status: "staged",
    source,
    stagedAt: new Date().toISOString(),
    snapshotId,
  };
}

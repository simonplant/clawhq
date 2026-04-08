/**
 * Pre-built skill loader — reads skill directories and returns them as FileEntry arrays.
 *
 * Skills are organized under src/design/skills/platform/ (always included),
 * src/design/skills/profiles/ (profile-specific pre-built skills), and
 * configs/skills/ (config-level skills). Profile and config skills are
 * selectable via blueprint.skill_bundle.included.
 *
 * Each skill is a directory containing at minimum a SKILL.md file.
 * The loader reads all files in the directory and returns them with
 * relativePaths targeting workspace/skills/<skillName>/.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── Types ───────────────────────────────────────────────────────────────────

/** A single file from a pre-built skill, ready for inclusion in a deployment bundle. */
export interface SkillFileEntry {
  /** Skill name (directory name, e.g. "cron-doctor"). */
  readonly skillName: string;
  /** Relative path within deploy directory (e.g. "workspace/skills/cron-doctor/SKILL.md"). */
  readonly relativePath: string;
  /** File content as a string. */
  readonly content: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

/** Allowed file extensions for skill files. */
const ALLOWED_EXTENSIONS = new Set([
  ".md", ".yaml", ".yml", ".json", ".txt",
]);

/** Maximum single file size (256 KB — skills are text, not binaries). */
const MAX_FILE_SIZE = 256 * 1024;

// ── Path Resolution ─────────────────────────────────────────────────────────

/** Resolve the platform skills directory (src/design/skills/platform/). */
function platformSkillsDir(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  return resolve(thisDir, "platform");
}

/** Resolve the src/design/skills/profiles/ directory (profile-specific pre-built skills). */
function profileSkillsDir(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  return resolve(thisDir, "profiles");
}

/** Resolve the configs/skills/ directory (config-level skills). */
function configSkillsDir(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  return resolve(thisDir, "..", "..", "..", "configs", "skills");
}

// ── Core Loader ─────────────────────────────────────────────────────────────

/**
 * Read all files from a single skill directory.
 *
 * Returns SkillFileEntry[] with relativePaths under workspace/skills/<skillName>/.
 * Skips files with disallowed extensions or that exceed the size limit.
 */
function readSkillDirectory(skillDir: string, skillName: string): SkillFileEntry[] {
  if (!existsSync(skillDir)) return [];

  const entries: SkillFileEntry[] = [];

  function walkDir(dir: string, relativeBase: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      const relativeSuffix = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        walkDir(fullPath, relativeSuffix);
      } else if (entry.isFile()) {
        const ext = entry.name.includes(".") ? `.${entry.name.split(".").pop()}` : "";
        if (!ALLOWED_EXTENSIONS.has(ext)) continue;

        const stat = statSync(fullPath);
        if (stat.size > MAX_FILE_SIZE) continue;

        entries.push({
          skillName,
          relativePath: `workspace/skills/${skillName}/${relativeSuffix}`,
          content: readFileSync(fullPath, "utf-8"),
        });
      }
    }
  }

  walkDir(skillDir, "");
  return entries;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Load all platform skills (always included in every deployment).
 *
 * Platform skills live in src/design/skills/platform/ and provide
 * universal operational capabilities (cron diagnostics, scanner triage).
 */
export function loadPlatformSkills(): SkillFileEntry[] {
  const dir = platformSkillsDir();
  if (!existsSync(dir)) return [];

  const entries: SkillFileEntry[] = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    entries.push(...readSkillDirectory(join(dir, item.name), item.name));
  }
  return entries;
}

/**
 * Load specific skills by name from profile and config skill directories.
 *
 * Used to resolve blueprint.skill_bundle.included — each name is looked up
 * first in src/design/skills/profiles/, then in configs/skills/.
 *
 * Skills that don't exist in either location are silently skipped
 * (they may be external skills installed at runtime via `clawhq skill install`).
 */
export function loadBlueprintSkills(skillNames: readonly string[]): SkillFileEntry[] {
  const profileDir = profileSkillsDir();
  const configDir = configSkillsDir();

  const entries: SkillFileEntry[] = [];
  for (const name of skillNames) {
    // Check profile skills first, then config skills
    const profilePath = join(profileDir, name);
    if (existsSync(profilePath)) {
      entries.push(...readSkillDirectory(profilePath, name));
      continue;
    }
    const configPath = join(configDir, name);
    entries.push(...readSkillDirectory(configPath, name));
  }
  return entries;
}

/**
 * List available platform skill names.
 */
export function listPlatformSkillNames(): string[] {
  const dir = platformSkillsDir();
  if (!existsSync(dir)) return [];

  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

/**
 * List available profile skill names (from src/design/skills/profiles/).
 */
export function listProfileSkillNames(): string[] {
  const dir = profileSkillsDir();
  if (!existsSync(dir)) return [];

  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

/**
 * List available config skill names (from configs/skills/).
 */
export function listConfigSkillNames(): string[] {
  const dir = configSkillsDir();
  if (!existsSync(dir)) return [];

  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

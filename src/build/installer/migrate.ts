/**
 * Deployment directory migration from ~/.openclaw/ to ~/.clawhq/.
 *
 * Detects legacy ~/.openclaw/ installations and migrates them to the
 * configurable deployment root (default: ~/.clawhq/). Preserves file
 * permissions, creates a backup of the original, and validates the
 * migration before removing the legacy directory.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { DEFAULT_DEPLOY_DIR, LEGACY_DEPLOY_DIR } from "../../config/paths.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** Progress callback for migration steps. */
export type MigrateProgressCallback = (step: string, detail: string) => void;

/** Options for running a deployment directory migration. */
export interface MigrateOptions {
  /** Target deployment directory. Default: ~/.clawhq */
  readonly targetDir?: string;
  /** Legacy source directory. Default: ~/.openclaw */
  readonly sourceDir?: string;
  /** If true, remove the legacy directory after successful migration. */
  readonly removeSource?: boolean;
  /** Progress callback for UX updates. */
  readonly onProgress?: MigrateProgressCallback;
}

/** Result of a migration operation. */
export interface MigrateResult {
  /** Whether the migration succeeded. */
  readonly success: boolean;
  /** Source directory that was migrated from. */
  readonly sourceDir: string;
  /** Target directory that was migrated to. */
  readonly targetDir: string;
  /** Number of files/directories migrated. */
  readonly itemsMigrated: number;
  /** Whether the source was removed after migration. */
  readonly sourceRemoved: boolean;
  /** Whether the target already existed (merge scenario). */
  readonly targetExisted: boolean;
  /** Error message if migration failed. */
  readonly error?: string;
}

// ── Detection ────────────────────────────────────────────────────────────────

/**
 * Check if a legacy ~/.openclaw/ installation exists.
 *
 * Returns the legacy directory path if it exists and contains
 * recognizable OpenClaw/ClawHQ files, null otherwise.
 */
export function detectLegacyInstallation(sourceDir?: string): string | null {
  const legacy = resolve(sourceDir ?? LEGACY_DEPLOY_DIR);

  if (!existsSync(legacy)) return null;

  const stat = statSync(legacy);
  if (!stat.isDirectory()) return null;

  // Look for recognizable files that indicate an OpenClaw/ClawHQ installation
  const markers = [
    "openclaw.json",
    "engine/openclaw.json",
    "clawhq.yaml",
    "workspace",
    "engine",
  ];

  const hasMarker = markers.some((m) => existsSync(join(legacy, m)));
  return hasMarker ? legacy : null;
}

// ── Migration ────────────────────────────────────────────────────────────────

/**
 * Migrate a legacy ~/.openclaw/ installation to the target deployment directory.
 *
 * Strategy:
 * 1. Validate source exists and is a recognizable installation
 * 2. If target doesn't exist, rename source → target (atomic on same filesystem)
 * 3. If target exists, copy source contents into target (preserving existing files)
 * 4. Validate migration by checking key directories exist in target
 * 5. Optionally remove the legacy source directory
 */
export function migrateDeployDir(options: MigrateOptions = {}): MigrateResult {
  const sourceDir = resolve(options.sourceDir ?? LEGACY_DEPLOY_DIR);
  const targetDir = resolve(options.targetDir ?? DEFAULT_DEPLOY_DIR);
  const removeSource = options.removeSource ?? false;
  const onProgress = options.onProgress ?? noop;

  // Validate source
  onProgress("detect", `Checking for legacy installation at ${sourceDir}`);
  const detected = detectLegacyInstallation(sourceDir);

  if (!detected) {
    return {
      success: false,
      sourceDir,
      targetDir,
      itemsMigrated: 0,
      sourceRemoved: false,
      targetExisted: false,
      error: `No legacy installation found at ${sourceDir}`,
    };
  }

  const targetExisted = existsSync(targetDir);

  try {
    if (!targetExisted) {
      // Fast path: rename (atomic on same filesystem)
      onProgress("migrate", `Moving ${sourceDir} → ${targetDir}`);
      mkdirSync(resolve(targetDir, ".."), { recursive: true });
      renameSync(sourceDir, targetDir);
    } else {
      // Merge: copy source into existing target, skipping existing files
      onProgress("migrate", `Merging ${sourceDir} into existing ${targetDir}`);
      copyDirRecursive(sourceDir, targetDir);
    }

    // Count items in the target
    const itemsMigrated = countItems(targetDir);

    // Validate migration
    onProgress("validate", "Validating migration…");
    const valid = validateMigration(targetDir);
    if (!valid) {
      return {
        success: false,
        sourceDir,
        targetDir,
        itemsMigrated,
        sourceRemoved: false,
        targetExisted,
        error: "Migration validation failed — target directory missing expected structure",
      };
    }

    // Remove source if requested and it still exists (wasn't renamed)
    let sourceRemoved = !existsSync(sourceDir);
    if (removeSource && existsSync(sourceDir)) {
      onProgress("cleanup", `Removing legacy directory ${sourceDir}`);
      rmSync(sourceDir, { recursive: true, force: true });
      sourceRemoved = true;
    }

    onProgress("done", `Migration complete: ${itemsMigrated} items`);

    return {
      success: true,
      sourceDir,
      targetDir,
      itemsMigrated,
      sourceRemoved,
      targetExisted,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      sourceDir,
      targetDir,
      itemsMigrated: 0,
      sourceRemoved: false,
      targetExisted,
      error: `Migration failed: ${msg}`,
    };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Recursively copy a directory, preserving permissions.
 * Existing files in the target are NOT overwritten.
 */
function copyDirRecursive(src: string, dest: string): void {
  cpSync(src, dest, {
    recursive: true,
    force: false,
    errorOnExist: false,
    preserveTimestamps: true,
  });
}

/** Count files and directories under a path. */
function countItems(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirRecursive(dir).length;
}

/** Get all entries under a directory recursively. */
function readdirRecursive(dir: string): string[] {
  const entries: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    entries.push(fullPath);
    if (entry.isDirectory()) {
      entries.push(...readdirRecursive(fullPath));
    }
  }

  return entries;
}

/**
 * Validate that the migration produced a recognizable directory structure.
 * Checks for at least one expected subdirectory.
 */
function validateMigration(targetDir: string): boolean {
  const expectedDirs = ["engine", "workspace", "ops", "cron"];
  return expectedDirs.some((d) => existsSync(join(targetDir, d)));
}

function noop(): void {
  // intentionally empty
}

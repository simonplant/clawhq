/**
 * Blueprint YAML loader.
 *
 * Loads blueprint files from multiple paths (built-in and local), enforcing
 * size limits and providing clear error messages for malformed input.
 *
 * Load paths (checked in order):
 * 1. Explicit file path (if provided)
 * 2. Built-in blueprints: configs/templates/ (shipped with ClawHQ)
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

import type { Blueprint } from "./types.js";
import { validateBlueprint } from "./validate.js";

// ── Constants ───────────────────────────────────────────────────────────────

/** Maximum blueprint file size in bytes (256 KB). */
const MAX_BLUEPRINT_SIZE_BYTES = 256 * 1024;

/** Blueprint file extension. */
const BLUEPRINT_EXT = ".yaml";

// ── Errors ──────────────────────────────────────────────────────────────────

/** Base error for blueprint loading failures. */
export class BlueprintLoadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BlueprintLoadError";
  }
}

/** Blueprint file exceeds the size limit. */
export class BlueprintSizeError extends BlueprintLoadError {
  readonly sizeBytes: number;
  readonly limitBytes: number;

  constructor(path: string, sizeBytes: number, limitBytes: number) {
    super(
      `Blueprint "${path}" is ${sizeBytes} bytes, exceeding the ${limitBytes} byte limit. ` +
        `This prevents loading oversized files that could cause performance issues.`,
    );
    this.name = "BlueprintSizeError";
    this.sizeBytes = sizeBytes;
    this.limitBytes = limitBytes;
  }
}

/** Blueprint YAML could not be parsed. */
export class BlueprintParseError extends BlueprintLoadError {
  constructor(path: string, cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to parse blueprint "${path}": ${msg}`, { cause });
    this.name = "BlueprintParseError";
  }
}

/** Blueprint failed validation. */
export class BlueprintValidationError extends BlueprintLoadError {
  readonly errors: readonly string[];

  constructor(path: string, errors: readonly string[]) {
    super(
      `Blueprint "${path}" failed validation:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
    this.name = "BlueprintValidationError";
    this.errors = errors;
  }
}

// ── Built-in Path Resolution ────────────────────────────────────────────────

/** Resolve the built-in blueprints directory relative to package root. */
function builtinBlueprintsDir(): string {
  // Navigate from src/design/blueprints/ up to project root, then to configs/templates/
  const thisDir = dirname(fileURLToPath(import.meta.url));
  return resolve(thisDir, "..", "..", "..", "configs", "templates");
}

// ── Single Blueprint Loading ────────────────────────────────────────────────

/**
 * Load a single blueprint from a file path.
 *
 * Enforces size limit, parses YAML, and validates structure.
 * Throws descriptive errors for each failure mode.
 */
export function loadBlueprintFile(filePath: string): Blueprint {
  const resolved = resolve(filePath);

  if (!existsSync(resolved)) {
    throw new BlueprintLoadError(`Blueprint not found: ${resolved}`);
  }

  // Size check — prevents DoS from oversized files
  const stat = statSync(resolved);
  if (stat.size > MAX_BLUEPRINT_SIZE_BYTES) {
    throw new BlueprintSizeError(resolved, stat.size, MAX_BLUEPRINT_SIZE_BYTES);
  }

  // Parse YAML
  const content = readFileSync(resolved, "utf-8");
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch (error) {
    throw new BlueprintParseError(resolved, error);
  }

  // Must be an object
  if (parsed === null || parsed === undefined) {
    throw new BlueprintParseError(resolved, new Error("File is empty"));
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BlueprintParseError(
      resolved,
      new Error(`Expected object, got ${Array.isArray(parsed) ? "array" : typeof parsed}`),
    );
  }

  // Validate structure
  const report = validateBlueprint(parsed as Record<string, unknown>);
  if (!report.valid) {
    const errorMessages = report.errors.map((e) => e.message);
    throw new BlueprintValidationError(resolved, errorMessages);
  }

  return parsed as Blueprint;
}

// ── Multi-Path Loading ──────────────────────────────────────────────────────

/** Result of loading a blueprint by name, including its source path. */
export interface LoadedBlueprint {
  readonly blueprint: Blueprint;
  readonly sourcePath: string;
  readonly isBuiltin: boolean;
}

/**
 * Load a blueprint by name or path.
 *
 * Resolution order:
 * 1. If `nameOrPath` is an absolute path or relative path to an existing file, load it directly
 * 2. Search built-in blueprints directory for a matching filename
 *
 * @param nameOrPath — Blueprint name (e.g., "family-hub") or file path
 * @returns Loaded blueprint with metadata
 */
export function loadBlueprint(nameOrPath: string): LoadedBlueprint {
  // Direct path — absolute or relative existing file
  const directPath = resolve(nameOrPath);
  if (existsSync(directPath) && statSync(directPath).isFile()) {
    return {
      blueprint: loadBlueprintFile(directPath),
      sourcePath: directPath,
      isBuiltin: false,
    };
  }

  // Search built-in blueprints
  const builtinDir = builtinBlueprintsDir();
  if (existsSync(builtinDir)) {
    // Try exact filename match
    const withExt = nameOrPath.endsWith(BLUEPRINT_EXT)
      ? nameOrPath
      : `${nameOrPath}${BLUEPRINT_EXT}`;
    const builtinPath = join(builtinDir, withExt);

    if (existsSync(builtinPath)) {
      return {
        blueprint: loadBlueprintFile(builtinPath),
        sourcePath: builtinPath,
        isBuiltin: true,
      };
    }
  }

  throw new BlueprintLoadError(
    `Blueprint "${nameOrPath}" not found. Searched:\n` +
      `  - ${directPath}\n` +
      `  - ${join(builtinBlueprintsDir(), nameOrPath + BLUEPRINT_EXT)}`,
  );
}

// ── List / Load All ─────────────────────────────────────────────────────────

/**
 * List all built-in blueprint files.
 *
 * Returns the filenames (without extension) of all YAML files in the
 * built-in blueprints directory.
 */
export function listBuiltinBlueprints(): string[] {
  const dir = builtinBlueprintsDir();
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith(BLUEPRINT_EXT))
    .map((f) => basename(f, BLUEPRINT_EXT))
    .sort();
}

/**
 * Load all built-in blueprints.
 *
 * Returns successfully loaded blueprints. Blueprints that fail to load
 * are skipped (the caller can use listBuiltinBlueprints + loadBlueprint
 * individually for error details).
 */
export function loadAllBuiltinBlueprints(): LoadedBlueprint[] {
  const names = listBuiltinBlueprints();
  const results: LoadedBlueprint[] = [];

  for (const name of names) {
    try {
      results.push(loadBlueprint(name));
    } catch {
      // Skip blueprints that fail to load — caller can load individually for errors
    }
  }

  return results;
}

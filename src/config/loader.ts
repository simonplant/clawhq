/**
 * YAML config loader with precedence merging.
 *
 * Loads ClawHQ configuration from three sources with project > user > defaults
 * precedence. Each layer overrides the previous one for scalar values and
 * deeply merges objects. Arrays are replaced, not concatenated.
 *
 * Sources (lowest to highest precedence):
 * 1. Built-in defaults
 * 2. User config: ~/.clawhq/clawhq.yaml
 * 3. Project config: ./clawhq.yaml (in current working directory)
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import { DEFAULT_DEPLOY_DIR } from "./paths.js";
import type { ClawHQConfig } from "./types.js";

// ── Constants ───────────────────────────────────────────────────────────────

const CONFIG_FILENAME = "clawhq.yaml";

// ── Defaults ────────────────────────────────────────────────────────────────

/** Built-in default configuration. Lowest precedence. */
export function defaultConfig(): ClawHQConfig {
  return {
    version: "1",
    installMethod: "cache",
    security: {
      posture: "hardened",
      egress: "restricted",
    },
    cloud: {
      enabled: false,
      trustMode: "paranoid",
    },
    paths: {
      deployDir: DEFAULT_DEPLOY_DIR,
      engineDir: join(DEFAULT_DEPLOY_DIR, "engine"),
      workspaceDir: join(DEFAULT_DEPLOY_DIR, "workspace"),
      opsDir: join(DEFAULT_DEPLOY_DIR, "ops"),
    },
  };
}

// ── Loader ──────────────────────────────────────────────────────────────────

/** Options for the config loader. */
export interface LoadConfigOptions {
  /** Override user config path. Default: ~/.clawhq/clawhq.yaml */
  readonly userConfigPath?: string;
  /** Override project config path. Default: ./clawhq.yaml */
  readonly projectConfigPath?: string;
  /** Override default config. */
  readonly defaults?: ClawHQConfig;
}

/**
 * Load and merge ClawHQ configuration.
 *
 * Precedence: project > user > defaults.
 * Missing files are silently skipped (user or project config may not exist).
 */
export function loadConfig(options: LoadConfigOptions = {}): ClawHQConfig {
  const defaults = options.defaults ?? defaultConfig();

  const userPath =
    options.userConfigPath ??
    join(DEFAULT_DEPLOY_DIR, CONFIG_FILENAME);

  const projectPath =
    options.projectConfigPath ??
    join(process.cwd(), CONFIG_FILENAME);

  const userConfig = loadYamlFile(userPath);
  const projectConfig = loadYamlFile(projectPath);

  return deepMerge(defaults, userConfig, projectConfig);
}

// ── YAML File Loading ───────────────────────────────────────────────────────

/**
 * Load a YAML file and return its contents, or an empty object if the
 * file doesn't exist or can't be parsed.
 */
function loadYamlFile(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};

  try {
    const content = readFileSync(filePath, "utf-8");
    const parsed = parseYaml(content) as unknown;
    if (parsed === null || parsed === undefined) return {};
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Expected object, got ${Array.isArray(parsed) ? "array" : typeof parsed}`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${filePath}: ${msg}`, { cause: error });
  }
}

// ── Deep Merge ──────────────────────────────────────────────────────────────

/**
 * Deep-merge multiple config objects. Later objects override earlier ones.
 *
 * Rules:
 * - Scalars: overridden by later value
 * - Objects: recursively merged
 * - Arrays: replaced entirely (not concatenated)
 * - undefined values in later objects don't override earlier values
 */
export function deepMerge<T extends Record<string, unknown>>(
  ...sources: readonly Record<string, unknown>[]
): T {
  const result: Record<string, unknown> = {};

  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) continue;

      const existing = result[key];

      if (
        isPlainObject(value) &&
        isPlainObject(existing)
      ) {
        result[key] = deepMerge(
          existing as Record<string, unknown>,
          value as Record<string, unknown>,
        );
      } else {
        result[key] = value;
      }
    }
  }

  return result as T;
}

/** Check if a value is a plain object (not an array, null, or other type). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Config loading from YAML files with merge precedence.
 *
 * Precedence (highest wins):
 *   1. Project config:  ./clawhq.yaml
 *   2. User config:     ~/.clawhq/config.yaml
 *   3. Built-in defaults
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { parse as parseYaml } from "yaml";

import type { ClawHQConfig } from "./schema.js";

const DEFAULT_CONFIG: ClawHQConfig = {
  openclaw: {
    home: join(homedir(), ".openclaw"),
    configPath: join(homedir(), ".openclaw", "openclaw.json"),
    source: {
      repo: "https://github.com/openclaw-ai/openclaw.git",
      version: undefined,
      cacheDir: join(homedir(), ".clawhq", "cache", "openclaw-source"),
    },
  },
  security: {
    posture: "hardened",
  },
  cloud: {
    enabled: false,
  },
  docker: {
    composePath: "./docker-compose.yml",
    networkName: "openclaw_default",
  },
};

function deepMerge<T extends Record<string, unknown>>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(override) as Array<keyof T>) {
    const overrideVal = override[key];
    const baseVal = result[key];
    if (
      overrideVal !== null &&
      overrideVal !== undefined &&
      typeof overrideVal === "object" &&
      !Array.isArray(overrideVal) &&
      typeof baseVal === "object" &&
      baseVal !== null &&
      !Array.isArray(baseVal)
    ) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overrideVal as Record<string, unknown>,
      ) as T[keyof T];
    } else if (overrideVal !== undefined) {
      result[key] = overrideVal as T[keyof T];
    }
  }
  return result;
}

async function loadYamlFile(filePath: string): Promise<ClawHQConfig | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    const parsed = parseYaml(content) as ClawHQConfig | null;
    return parsed ?? null;
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export function getUserConfigPath(): string {
  return join(homedir(), ".clawhq", "config.yaml");
}

export function getProjectConfigPath(cwd?: string): string {
  return resolve(cwd ?? process.cwd(), "clawhq.yaml");
}

export interface LoadConfigOptions {
  cwd?: string;
  userConfigPath?: string;
  projectConfigPath?: string;
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<ClawHQConfig> {
  const userPath = options.userConfigPath ?? getUserConfigPath();
  const projectPath = options.projectConfigPath ?? getProjectConfigPath(options.cwd);

  const userConfig = await loadYamlFile(userPath);
  const projectConfig = await loadYamlFile(projectPath);

  let config = { ...DEFAULT_CONFIG };

  if (userConfig) {
    config = deepMerge(config, userConfig);
  }
  if (projectConfig) {
    config = deepMerge(config, projectConfig);
  }

  return config;
}

export async function loadOpenClawConfig(configPath: string): Promise<Record<string, unknown>> {
  const content = await readFile(configPath, "utf-8");
  return JSON.parse(content) as Record<string, unknown>;
}

export { DEFAULT_CONFIG, deepMerge };

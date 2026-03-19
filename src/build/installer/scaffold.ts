/**
 * Deployment directory scaffolding for `clawhq install`.
 *
 * Creates the ~/.clawhq/ directory structure defined in ARCHITECTURE.md.
 * Uses the atomic writer from design/configure for the clawhq.yaml file.
 */

import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { stringify as yamlStringify } from "yaml";

import { defaultConfig } from "../../config/loader.js";
import type { ClawHQConfig, InstallMethod } from "../../config/types.js";
import { writeFileAtomic } from "../../design/configure/writer.js";

import type { ScaffoldResult } from "./types.js";

// ── Directory Structure ─────────────────────────────────────────────────────

/**
 * Subdirectories to create under the deploy root.
 * Matches the structure in ARCHITECTURE.md § The Deployment Directory.
 */
const SCAFFOLD_DIRS = [
  "engine",
  "workspace",
  "workspace/identity",
  "workspace/tools",
  "workspace/skills",
  "workspace/memory",
  "ops",
  "ops/doctor",
  "ops/monitor",
  "ops/backup/snapshots",
  "ops/updater/rollback",
  "ops/audit",
  "ops/firewall",
  "security",
  "cron",
  "cloud",
] as const;

// ── Scaffold ────────────────────────────────────────────────────────────────

/**
 * Create the deployment directory structure.
 *
 * Idempotent — existing directories are left untouched. Missing directories
 * (including the root) are created with default permissions.
 */
export function scaffoldDirs(deployDir: string): ScaffoldResult {
  const root = resolve(deployDir);
  const created: string[] = [];

  // Create root
  mkdirSync(root, { recursive: true });
  created.push(root);

  // Create each subdirectory
  for (const sub of SCAFFOLD_DIRS) {
    const dir = join(root, sub);
    mkdirSync(dir, { recursive: true });
    created.push(dir);
  }

  return { created, deployDir: root };
}

// ── Config Generation ───────────────────────────────────────────────────────

/** Options for writing the initial clawhq.yaml. */
export interface WriteConfigOptions {
  readonly deployDir: string;
  readonly installMethod?: InstallMethod;
}

/**
 * Write the initial clawhq.yaml with sensible defaults.
 *
 * Uses the project's `defaultConfig()` and overrides paths to match the
 * actual deploy directory. Returns the absolute path to the written file.
 */
export function writeInitialConfig(options: WriteConfigOptions): string {
  const root = resolve(options.deployDir);
  const configPath = join(root, "clawhq.yaml");

  const config: ClawHQConfig = {
    ...defaultConfig(),
    installMethod: options.installMethod ?? "cache",
    paths: {
      deployDir: root,
      engineDir: join(root, "engine"),
      workspaceDir: join(root, "workspace"),
      opsDir: join(root, "ops"),
    },
  };

  const content = yamlStringify(config);
  writeFileAtomic(configPath, content);

  return configPath;
}

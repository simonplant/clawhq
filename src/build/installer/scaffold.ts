/**
 * Deployment directory scaffolding for `clawhq install`.
 *
 * Creates the ~/.clawhq/ directory structure defined in ARCHITECTURE.md.
 * Uses the atomic writer from design/configure for the clawhq.yaml file.
 */

import { chmodSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { stringify as yamlStringify } from "yaml";

import { defaultConfig } from "../../config/loader.js";
import { DIR_MODE_SECRET } from "../../config/defaults.js";
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
  "ops",
  "ops/doctor",
  "ops/monitor",
  "ops/backup/snapshots",
  "ops/updater/rollback",
  "ops/audit",
  "ops/firewall",
  "cron",
] as const;

/**
 * Subdirectories that hold secrets (API tokens, trust-mode config).
 * Created with DIR_MODE_SECRET (0o700) and chmod'd to fix existing installs.
 */
const SCAFFOLD_DIRS_SECRET = ["security", "cloud", "workspace/memory"] as const;

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

  // Create standard subdirectories
  for (const sub of SCAFFOLD_DIRS) {
    const dir = join(root, sub);
    mkdirSync(dir, { recursive: true });
    created.push(dir);
  }

  // Create secret subdirectories with restricted permissions.
  // chmodSync is applied after mkdirSync because recursive:true does NOT
  // change the mode of already-existing directories — this fixes installs
  // where scaffold has previously run with default (0755) permissions.
  for (const sub of SCAFFOLD_DIRS_SECRET) {
    const dir = join(root, sub);
    mkdirSync(dir, { recursive: true, mode: DIR_MODE_SECRET });
    chmodSync(dir, DIR_MODE_SECRET);
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

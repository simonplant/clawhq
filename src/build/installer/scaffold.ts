/**
 * Deployment directory scaffolding for `clawhq install`.
 *
 * Creates the ~/.clawhq/ directory structure defined in ARCHITECTURE.md.
 * Uses the atomic writer from design/configure for the clawhq.yaml file.
 */

import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { stringify as yamlStringify } from "yaml";

import { DIR_MODE_SECRET } from "../../config/defaults.js";
import { defaultConfig } from "../../config/loader.js";
import type { ClawHQConfig, InstallMethod } from "../../config/types.js";
import { writeFileAtomic } from "../../config/fs-atomic.js";

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
  "workspace/state",
  "shared",
  "ops",
  "ops/doctor",
  "ops/monitor",
  "ops/backup/snapshots",
  "ops/updater/rollback",
  "ops/firewall",
  "cron",
] as const;

/**
 * Subdirectories that hold secrets (API tokens, trust-mode config).
 * Created with DIR_MODE_SECRET (0o700) and chmod'd to fix existing installs.
 */
const SCAFFOLD_DIRS_SECRET = ["security", "cloud", "workspace/memory", "ops/audit"] as const;

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
 * Honors the seeded-once ownership contract: if a clawhq.yaml exists at the
 * target path for any reason — partial, composition-less, or fully populated —
 * this function preserves it and returns. An existing file is the user's
 * input manifest; install must never rewrite it. Flows that deliberately
 * need a fresh yaml (e.g. `clawhq init --reset`) archive the existing file
 * into the attic before reaching this path, so the preservation is a no-op
 * in that case.
 *
 * Previously the guard only preserved when `composition.profile` was present,
 * which silently overwrote any partial yaml — that was the root of the
 * 2026-04-21 stub-clobber incident. Ownership is now the sole contract.
 */
export function writeInitialConfig(options: WriteConfigOptions): string {
  const root = resolve(options.deployDir);
  const configPath = join(root, "clawhq.yaml");

  if (existsSync(configPath)) {
    return configPath;
  }

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

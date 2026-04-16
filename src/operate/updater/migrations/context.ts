/**
 * MigrationContext factory — safe read/write access to deployment files.
 *
 * Reads openclaw.json, docker-compose.yml, and .env from the engine
 * directory and provides structured write-back functions.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { FILE_MODE_CONFIG, FILE_MODE_SECRET } from "../../../config/defaults.js";

import type { MigrationContext } from "./types.js";

/**
 * Create a MigrationContext for a deployment directory.
 *
 * Reads current state from disk. Write functions update files in place.
 */
export async function createMigrationContext(
  deployDir: string,
  signal?: AbortSignal,
): Promise<MigrationContext> {
  const engineDir = join(deployDir, "engine");
  const configPath = join(engineDir, "openclaw.json");
  const composePath = join(engineDir, "docker-compose.yml");
  const envPath = join(engineDir, ".env");

  let config: Record<string, unknown> = {};
  try {
    const raw = await readFile(configPath, "utf-8");
    config = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Config may not exist yet
  }

  let compose = "";
  try {
    compose = await readFile(composePath, "utf-8");
  } catch {
    // Compose may not exist yet
  }

  let env = "";
  try {
    env = await readFile(envPath, "utf-8");
  } catch {
    // .env may not exist
  }

  return {
    deployDir,
    signal,
    config,
    compose,
    env,

    async writeConfig(newConfig: Record<string, unknown>): Promise<void> {
      await writeFile(configPath, JSON.stringify(newConfig, null, 2) + "\n", {
        encoding: "utf-8",
        mode: FILE_MODE_CONFIG,
      });
    },

    async writeCompose(newCompose: string): Promise<void> {
      await writeFile(composePath, newCompose, {
        encoding: "utf-8",
        mode: FILE_MODE_CONFIG,
      });
    },

    async writeEnv(newEnv: string): Promise<void> {
      await writeFile(envPath, newEnv, {
        encoding: "utf-8",
        mode: FILE_MODE_SECRET,
      });
    },

    async readEngineFile(relativePath: string): Promise<string | null> {
      try {
        return await readFile(join(engineDir, relativePath), "utf-8");
      } catch {
        return null;
      }
    },

    async writeEngineFile(relativePath: string, content: string): Promise<void> {
      await writeFile(join(engineDir, relativePath), content, "utf-8");
    },
  };
}

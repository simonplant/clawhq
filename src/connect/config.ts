/**
 * Channel config helpers.
 *
 * Read/write channel configuration to openclaw.json and secrets to .env.
 * Follows the project convention: secrets in .env only, config in openclaw.json.
 */

import { readFile, writeFile } from "node:fs/promises";

import type { ChannelConfig, OpenClawConfig } from "../config/schema.js";
import { parseEnv, readEnvFile, serializeEnv, setEnvValue } from "../security/secrets/env.js";

/**
 * Read a channel credential from the .env file.
 * Returns undefined if the file doesn't exist or the key is missing.
 */
export async function readChannelEnv(envPath: string, envVar: string): Promise<string | undefined> {
  try {
    const env = await readEnvFile(envPath);
    const entry = env.entries.find((e) => e.type === "pair" && e.key === envVar);
    return entry?.value;
  } catch {
    return undefined;
  }
}

/**
 * Write a channel credential to the .env file.
 * Creates the file if it doesn't exist; updates the key if it does.
 */
export async function writeChannelEnv(envPath: string, envVar: string, value: string): Promise<void> {
  let env;
  try {
    env = await readEnvFile(envPath);
  } catch {
    // File doesn't exist — create with just this entry
    env = parseEnv("");
  }

  setEnvValue(env, envVar, value);
  await writeFile(envPath, serializeEnv(env), "utf-8");
}

/**
 * Read the channels section from openclaw.json.
 * Returns undefined if the file doesn't exist or has no channels.
 */
export async function readOpenClawChannels(configPath: string): Promise<Record<string, ChannelConfig> | undefined> {
  try {
    const content = await readFile(configPath, "utf-8");
    const config = JSON.parse(content) as OpenClawConfig;
    return config.channels;
  } catch {
    return undefined;
  }
}

/**
 * Write a channel config entry to openclaw.json.
 * Preserves existing config; merges the new channel entry.
 */
export async function writeChannelConfig(
  configPath: string,
  channelName: string,
  channelConfig: ChannelConfig,
): Promise<void> {
  let config: Record<string, unknown>;
  try {
    const content = await readFile(configPath, "utf-8");
    config = JSON.parse(content) as Record<string, unknown>;
  } catch {
    // File doesn't exist — create minimal config
    config = {};
  }

  const channels = (config.channels ?? {}) as Record<string, unknown>;
  channels[channelName] = channelConfig;
  config.channels = channels;

  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

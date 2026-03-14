/**
 * Fleet agent discovery.
 *
 * Discovers agents from the OpenClaw config file (agents.list) or from
 * a fleet configuration file listing remote agent endpoints.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { FleetAgent } from "./types.js";

/**
 * Discover agents configured in the OpenClaw config.
 *
 * Reads `openclaw.json` and extracts the agents list.
 * For single-agent deployments (no agents.list), returns a single
 * default agent entry.
 */
export async function discoverAgents(options: {
  openclawHome?: string;
  configPath?: string;
}): Promise<FleetAgent[]> {
  const openclawHome = (options.openclawHome ?? "~/.openclaw").replace(
    /^~/,
    process.env.HOME ?? "~",
  );
  const configPath =
    options.configPath?.replace(/^~/, process.env.HOME ?? "~") ??
    join(openclawHome, "openclaw.json");

  let config: Record<string, unknown>;
  try {
    const raw = await readFile(configPath, "utf-8");
    config = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // No config found — return empty fleet
    return [];
  }

  const agents = (config["agents"] ?? {}) as Record<string, unknown>;
  const list = (agents["list"] ?? []) as Array<Record<string, unknown>>;

  if (list.length === 0) {
    // Single-agent deployment
    return [
      {
        id: "default",
        workspace: join(openclawHome, "workspace"),
        isDefault: true,
        openclawHome,
      },
    ];
  }

  return list.map((entry) => ({
    id: String(entry["id"] ?? "unknown"),
    workspace: String(entry["workspace"] ?? ""),
    isDefault: Boolean(entry["default"]),
    openclawHome,
  }));
}

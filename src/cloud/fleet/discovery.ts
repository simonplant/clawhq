/**
 * Fleet agent discovery — find and inspect all registered agents.
 *
 * Agents are tracked in a fleet registry file. Discovery checks each
 * registered directory for a valid deployment, collects health metadata
 * without reading content.
 */

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { DIR_MODE_SECRET, FILE_MODE_SECRET } from "../../config/defaults.js";
import { DEPLOY_CLOUD_SUBDIR, DEPLOY_ENGINE_OPENCLAW_JSON, DEPLOY_ENGINE_SUBDIR } from "../../config/paths.js";
import { collectHealthReport } from "../heartbeat/reporter.js";
import { readTrustModeState } from "../trust-modes/index.js";

import type {
  DiscoveredAgent,
  FleetAgent,
  FleetDiscoveryResult,
  FleetRegistry,
} from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const FLEET_FILE = "fleet.json";

// ── Path helpers ─────────────────────────────────────────────────────────────

/** Resolve fleet.json path for a deployment directory. */
export function fleetRegistryPath(deployDir: string): string {
  return join(deployDir, DEPLOY_CLOUD_SUBDIR, FLEET_FILE);
}

// ── Registry management ──────────────────────────────────────────────────────

/** Read fleet registry from disk. Returns empty registry if file doesn't exist. */
export function readFleetRegistry(deployDir: string): FleetRegistry {
  const path = fleetRegistryPath(deployDir);
  if (!existsSync(path)) {
    return { version: 1, agents: [] };
  }
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as FleetRegistry;
  } catch {
    return { version: 1, agents: [] };
  }
}

/** Write fleet registry atomically. */
function writeFleetRegistry(deployDir: string, registry: FleetRegistry): void {
  const path = fleetRegistryPath(deployDir);
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: DIR_MODE_SECRET });
  }

  const content = JSON.stringify(registry, null, 2) + "\n";
  const tmpName = `.fleet.tmp.${randomBytes(6).toString("hex")}`;
  const tmpPath = join(dir, tmpName);

  try {
    writeFileSync(tmpPath, content, { mode: FILE_MODE_SECRET });
    chmodSync(tmpPath, FILE_MODE_SECRET);
    renameSync(tmpPath, path);
  } catch (err) {
    // Write failed — fleet registry is best-effort
    console.warn("[fleet] registry write failed:", err instanceof Error ? err.message : String(err));
  }
}

/** Register an agent in the fleet. No-op if already registered at same path. */
export function registerAgent(
  deployDir: string,
  name: string,
  agentDeployDir: string,
): FleetAgent {
  const registry = readFleetRegistry(deployDir);

  // Check for duplicate path
  const existing = registry.agents.find((a) => a.deployDir === agentDeployDir);
  if (existing) {
    return existing;
  }

  const agent: FleetAgent = {
    name,
    deployDir: agentDeployDir,
    addedAt: new Date().toISOString(),
  };

  writeFleetRegistry(deployDir, {
    ...registry,
    agents: [...registry.agents, agent],
  });

  return agent;
}

/** Remove an agent from the fleet by name or path. */
export function unregisterAgent(
  deployDir: string,
  nameOrPath: string,
): boolean {
  const registry = readFleetRegistry(deployDir);
  const filtered = registry.agents.filter(
    (a) => a.name !== nameOrPath && a.deployDir !== nameOrPath,
  );

  if (filtered.length === registry.agents.length) {
    return false; // Nothing removed
  }

  writeFleetRegistry(deployDir, { ...registry, agents: filtered });
  return true;
}

// ── Discovery ────────────────────────────────────────────────────────────────

/** Check if a deployment directory has a valid engine configuration. */
function isConfigured(agentDeployDir: string): boolean {
  return existsSync(join(agentDeployDir, DEPLOY_ENGINE_SUBDIR, DEPLOY_ENGINE_OPENCLAW_JSON));
}

/** Discover a single agent — check existence, config, and collect health. */
async function discoverAgent(agent: FleetAgent): Promise<DiscoveredAgent> {
  const exists = existsSync(agent.deployDir);
  if (!exists) {
    return { name: agent.name, deployDir: agent.deployDir, exists: false, configured: false };
  }

  const configured = isConfigured(agent.deployDir);
  if (!configured) {
    return { name: agent.name, deployDir: agent.deployDir, exists: true, configured: false };
  }

  // Collect health — uses the agent's own trust mode
  const trustState = readTrustModeState(agent.deployDir);
  const health = await collectHealthReport(agent.deployDir, trustState.mode);

  return {
    name: agent.name,
    deployDir: agent.deployDir,
    exists: true,
    configured: true,
    health,
  };
}

/**
 * Discover all registered agents in the fleet.
 *
 * Checks each registered directory for existence, valid config, and
 * collects health metadata. Never reads content.
 */
export async function discoverFleet(deployDir: string): Promise<FleetDiscoveryResult> {
  const registry = readFleetRegistry(deployDir);
  const agents = await Promise.all(registry.agents.map(discoverAgent));

  const activeCount = agents.filter((a) => a.exists && a.configured).length;

  return {
    agents,
    activeCount,
    totalCount: agents.length,
    timestamp: new Date().toISOString(),
  };
}

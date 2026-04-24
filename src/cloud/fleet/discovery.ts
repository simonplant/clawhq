/**
 * Fleet agent discovery — find and inspect all registered agents.
 *
 * This module is now an adapter over the unified instance registry
 * (`src/cloud/instances/`). The `FleetAgent` / `FleetRegistry` shapes stay
 * for backwards compatibility with the CLI and formatters, but the source
 * of truth is `~/.clawhq/instances.json`. The `deployDir` parameter on
 * these functions is preserved for API compatibility and is ignored —
 * the unified registry is machine-global, not per-deployment.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { DEPLOY_ENGINE_OPENCLAW_JSON, DEPLOY_ENGINE_SUBDIR } from "../../config/paths.js";
import { collectHealthReport } from "../heartbeat/reporter.js";
import {
  addInstance,
  findByName,
  listInstances,
  readRegistry,
  registryPath,
  removeInstance,
} from "../instances/index.js";
import type { Instance } from "../instances/index.js";
import { readTrustModeState } from "../trust-modes/index.js";

import type {
  DiscoveredAgent,
  FleetAgent,
  FleetDiscoveryResult,
  FleetRegistry,
} from "./types.js";

// ── Path helpers ─────────────────────────────────────────────────────────────

/** Path to the persisted registry — now resolves to `~/.clawhq/instances.json`. */
export function fleetRegistryPath(_deployDir: string): string {
  return registryPath();
}

// ── Projection helpers ───────────────────────────────────────────────────────

/** Project a unified `Instance` into the legacy `FleetAgent` shape. */
function toFleetAgent(instance: Instance): FleetAgent | undefined {
  if (instance.location.kind !== "local") return undefined;
  return {
    name: instance.name,
    deployDir: instance.location.deployDir,
    addedAt: instance.createdAt,
  };
}

/** Project the unified registry into the legacy `FleetRegistry` shape. */
function projectFleet(): FleetRegistry {
  const instances = readRegistry().instances;
  const agents: FleetAgent[] = [];
  for (const inst of instances) {
    const agent = toFleetAgent(inst);
    if (agent) agents.push(agent);
  }
  return { version: 1, agents };
}

// ── Registry management (back-compat adapter) ────────────────────────────────

/** Read fleet registry — returns local instances from the unified registry. */
export function readFleetRegistry(_deployDir: string): FleetRegistry {
  return projectFleet();
}

/**
 * Register a local agent in the fleet. Idempotent: if an entry already
 * exists for `agentDeployDir`, returns that entry unchanged. Otherwise
 * mints a new instance in the unified registry.
 */
export function registerAgent(
  _deployDir: string,
  name: string,
  agentDeployDir: string,
): FleetAgent {
  // Idempotent by deployDir.
  for (const inst of listInstances()) {
    if (inst.location.kind === "local" && inst.location.deployDir === agentDeployDir) {
      return { name: inst.name, deployDir: agentDeployDir, addedAt: inst.createdAt };
    }
  }

  // Resolve a unique name — suffix on collision.
  let finalName = name;
  let suffix = 2;
  while (findByName(finalName)) {
    finalName = `${name}-${suffix}`;
    suffix += 1;
  }

  const inst = addInstance({
    name: finalName,
    status: "initialized",
    location: { kind: "local", deployDir: agentDeployDir },
  });
  return { name: inst.name, deployDir: agentDeployDir, addedAt: inst.createdAt };
}

/** Remove a local agent from the fleet by name or by deployDir. */
export function unregisterAgent(_deployDir: string, nameOrPath: string): boolean {
  for (const inst of listInstances()) {
    if (inst.location.kind !== "local") continue;
    if (inst.name === nameOrPath || inst.location.deployDir === nameOrPath) {
      return removeInstance(inst.id);
    }
  }
  return false;
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
export async function discoverFleet(_deployDir: string): Promise<FleetDiscoveryResult> {
  const registry = projectFleet();
  const agents = await Promise.all(registry.agents.map(discoverAgent));

  const activeCount = agents.filter((a) => a.exists && a.configured).length;

  return {
    agents,
    activeCount,
    totalCount: agents.length,
    timestamp: new Date().toISOString(),
  };
}

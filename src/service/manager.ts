/**
 * Service management — add, remove, and list backing services.
 *
 * Manages backing infrastructure (postgres, redis, qdrant) in docker-compose
 * alongside the agent container. Services are auto-wired: env vars injected,
 * networking configured, health checks applied.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { parseComposeYaml, composeToYaml } from "../docker/hardening.js";
import {
  readEnvFile,
  setEnvValue,
  atomicWriteEnvFile,
  removeEnvValue,
} from "../security/secrets/env.js";

import {
  BUILTIN_SERVICES,
  ServiceError,
  type ServiceDefinition,
  type ServiceEntry,
} from "./types.js";

/** Remove a single key from an object without dynamic delete. */
function omitKey<T>(obj: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));
}

/** Remove multiple keys from an object without dynamic delete. */
function omitKeys<T>(obj: Record<string, T>, keys: Set<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.has(k)));
}

export interface ServiceContext {
  openclawHome: string;
  clawhqDir: string;
}

function composePath(ctx: ServiceContext): string {
  return join(ctx.openclawHome, "docker-compose.yml");
}

function envPath(ctx: ServiceContext): string {
  return join(ctx.openclawHome, ".env");
}

function serviceKey(name: string): string {
  return `clawhq-${name}`;
}

/**
 * Resolve a service definition by name from the built-in registry.
 */
export function resolveService(name: string): ServiceDefinition {
  const def = BUILTIN_SERVICES[name];
  if (!def) {
    const available = Object.keys(BUILTIN_SERVICES).join(", ");
    throw new ServiceError(
      `Unknown service "${name}". Available: ${available}`,
      "UNKNOWN_SERVICE",
    );
  }
  return def;
}

/**
 * Add a backing service to docker-compose.yml and inject env vars into .env.
 */
export async function addService(
  ctx: ServiceContext,
  name: string,
): Promise<{ definition: ServiceDefinition; composePath: string }> {
  const def = resolveService(name);
  const cPath = composePath(ctx);

  // Read existing compose
  let composeContent: string;
  try {
    composeContent = await readFile(cPath, "utf-8");
  } catch {
    throw new ServiceError(
      `Cannot read docker-compose.yml at ${cPath}. Run \`clawhq init\` first.`,
      "NO_COMPOSE",
    );
  }

  const compose = parseComposeYaml(composeContent);
  const services = (compose["services"] ?? {}) as Record<string, unknown>;
  const key = serviceKey(name);

  if (services[key]) {
    throw new ServiceError(
      `Service "${name}" is already configured in docker-compose.yml.`,
      "ALREADY_EXISTS",
    );
  }

  // Detect the network the agent uses
  const agentNetwork = detectAgentNetwork(services);

  // Build service definition for compose
  const svcConfig: Record<string, unknown> = {
    image: def.image,
    container_name: key,
    restart: "unless-stopped",
    healthcheck: {
      test: def.healthCheck.test,
      interval: def.healthCheck.interval,
      timeout: def.healthCheck.timeout,
      retries: def.healthCheck.retries,
    },
  };

  if (Object.keys(def.envVars).length > 0) {
    svcConfig["environment"] = def.envVars;
  }

  if (def.volumes.length > 0) {
    svcConfig["volumes"] = [...def.volumes];
  }

  if (agentNetwork) {
    svcConfig["networks"] = [agentNetwork];
    if (def.networkAliases.length > 0) {
      svcConfig["networks"] = {
        [agentNetwork]: {
          aliases: def.networkAliases,
        },
      };
    }
  }

  // Add service to compose
  services[key] = svcConfig;
  compose["services"] = services;

  // Add named volumes
  const volumes = (compose["volumes"] ?? {}) as Record<string, unknown>;
  for (const vol of def.volumes) {
    const volName = vol.split(":")[0];
    if (!volumes[volName]) {
      volumes[volName] = null; // docker-compose default driver
    }
  }
  if (Object.keys(volumes).length > 0) {
    compose["volumes"] = volumes;
  }

  // Write compose back
  await writeFile(cPath, composeToYaml(compose), "utf-8");

  // Inject agent env vars into .env
  try {
    const ePath = envPath(ctx);
    const env = await readEnvFile(ePath);
    for (const [k, v] of Object.entries(def.agentEnvVars)) {
      setEnvValue(env, k, v);
    }
    await atomicWriteEnvFile(ePath, env);
  } catch {
    // .env may not exist yet — that's OK, agent env vars are optional convenience
  }

  return { definition: def, composePath: cPath };
}

/**
 * Remove a backing service from docker-compose.yml.
 * By default preserves volumes (data). Pass deleteData: true to remove volumes.
 */
export async function removeService(
  ctx: ServiceContext,
  name: string,
  opts: { deleteData?: boolean } = {},
): Promise<{ definition: ServiceDefinition; volumesRemoved: boolean }> {
  const def = resolveService(name);
  const cPath = composePath(ctx);

  let composeContent: string;
  try {
    composeContent = await readFile(cPath, "utf-8");
  } catch {
    throw new ServiceError(
      `Cannot read docker-compose.yml at ${cPath}.`,
      "NO_COMPOSE",
    );
  }

  const compose = parseComposeYaml(composeContent);
  const services = (compose["services"] ?? {}) as Record<string, unknown>;
  const key = serviceKey(name);

  if (!services[key]) {
    throw new ServiceError(
      `Service "${name}" is not configured in docker-compose.yml.`,
      "NOT_FOUND",
    );
  }

  // Remove service — rebuild without the key
  compose["services"] = omitKey(services, key);

  // Optionally remove volumes
  let volumesRemoved = false;
  if (opts.deleteData) {
    const volumes = (compose["volumes"] ?? {}) as Record<string, unknown>;
    const volNames = new Set(def.volumes.map((v) => v.split(":")[0]));
    const remaining = omitKeys(volumes, volNames);
    if (Object.keys(remaining).length > 0) {
      compose["volumes"] = remaining;
    } else {
      compose["volumes"] = undefined;
    }
    volumesRemoved = true;
  }

  await writeFile(cPath, composeToYaml(compose), "utf-8");

  // Remove agent env vars from .env
  try {
    const ePath = envPath(ctx);
    const env = await readEnvFile(ePath);
    for (const k of Object.keys(def.agentEnvVars)) {
      removeEnvValue(env, k);
    }
    await atomicWriteEnvFile(ePath, env);
  } catch {
    // .env may not exist — not an error
  }

  return { definition: def, volumesRemoved };
}

/**
 * List all ClawHQ-managed services from docker-compose.yml with status.
 */
export async function listServices(
  ctx: ServiceContext,
): Promise<ServiceEntry[]> {
  const cPath = composePath(ctx);

  let composeContent: string;
  try {
    composeContent = await readFile(cPath, "utf-8");
  } catch {
    return [];
  }

  const compose = parseComposeYaml(composeContent);
  const services = (compose["services"] ?? {}) as Record<string, Record<string, unknown>>;

  const entries: ServiceEntry[] = [];
  const prefix = "clawhq-";

  for (const [key, svc] of Object.entries(services)) {
    if (!key.startsWith(prefix)) continue;

    const name = key.slice(prefix.length);
    const image = (svc["image"] as string) ?? "unknown";

    entries.push({
      name,
      image,
      status: "unknown",
      health: "unknown",
    });
  }

  return entries;
}

/**
 * Format service list for CLI display.
 */
export function formatServiceList(entries: ServiceEntry[]): string {
  if (entries.length === 0) {
    return "No backing services configured.\n\nAvailable: " +
      Object.keys(BUILTIN_SERVICES).join(", ") +
      "\nAdd one with: clawhq service add <name>";
  }

  const nameWidth = Math.max(4, ...entries.map((e) => e.name.length));
  const imageWidth = Math.max(5, ...entries.map((e) => e.image.length));

  const lines: string[] = [];
  lines.push(
    `${"NAME".padEnd(nameWidth)}  ${"IMAGE".padEnd(imageWidth)}  STATUS     HEALTH`,
  );
  lines.push("-".repeat(nameWidth + imageWidth + 24));

  for (const entry of entries) {
    lines.push(
      `${entry.name.padEnd(nameWidth)}  ${entry.image.padEnd(imageWidth)}  ${entry.status.padEnd(9)}  ${entry.health}`,
    );
  }

  return lines.join("\n");
}

/**
 * Detect the network name used by the first agent service in compose.
 */
function detectAgentNetwork(
  services: Record<string, unknown>,
): string | null {
  for (const [, svc] of Object.entries(services)) {
    const s = svc as Record<string, unknown>;
    const nets = s["networks"];
    if (Array.isArray(nets) && nets.length > 0) {
      return nets[0] as string;
    }
    if (nets && typeof nets === "object" && !Array.isArray(nets)) {
      const keys = Object.keys(nets);
      if (keys.length > 0) return keys[0];
    }
  }
  return null;
}

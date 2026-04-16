/**
 * List backing services configured in the deployment.
 *
 * Reads docker-compose.yml and identifies which backing services
 * (postgres, redis, qdrant) are present.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as yamlParse } from "yaml";

import { SUPPORTED_SERVICES } from "./definitions.js";
import type { ServiceEntry, ServiceListOptions, ServiceListResult } from "./types.js";

/**
 * List all backing services configured in docker-compose.yml.
 */
export function listServices(options: ServiceListOptions): ServiceListResult {
  const composePath = join(options.deployDir, "engine", "docker-compose.yml");

  let composeRaw: string;
  try {
    composeRaw = readFileSync(composePath, "utf-8");
  } catch {
    return { services: [] };
  }

  let compose: Record<string, unknown>;
  try {
    compose = yamlParse(composeRaw) as Record<string, unknown>;
  } catch {
    return { services: [] };
  }

  const services = (compose["services"] ?? {}) as Record<string, Record<string, unknown>>;
  const entries: ServiceEntry[] = [];

  for (const name of SUPPORTED_SERVICES) {
    const svc = services[name];
    if (svc) {
      entries.push({
        name,
        image: typeof svc["image"] === "string" ? svc["image"] : "unknown",
        status: "configured",
      });
    }
  }

  return { services: entries };
}

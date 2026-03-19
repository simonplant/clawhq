/**
 * Add a backing service (postgres, redis, qdrant) to the deployment.
 *
 * Reads the existing docker-compose.yml, adds the service definition,
 * writes updated compose back, and adds required env vars to .env.
 *
 * Services are connected to the agent via the clawhq_net Docker network.
 * Each service gets a healthcheck, named volume, and secure defaults.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

import { parse as yamlParse, stringify as yamlStringify } from "yaml";

import { parseEnv, readEnv, setEnvValue, writeEnvAtomic } from "../../secure/credentials/env-store.js";

import { getServiceConfig } from "./definitions.js";
import type { ServiceAddOptions, ServiceAddResult, ServiceName } from "./types.js";

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Add a backing service to the deployment's docker-compose.yml and .env.
 *
 * Idempotent: if the service already exists in compose, returns success
 * without modifying anything.
 */
export async function addService(options: ServiceAddOptions): Promise<ServiceAddResult> {
  const { deployDir, service } = options;
  const composePath = join(deployDir, "engine", "docker-compose.yml");
  const envPath = join(deployDir, "engine", ".env");

  // Load service definition
  const config = getServiceConfig(service);

  // Read existing compose
  let composeRaw: string;
  try {
    composeRaw = readFileSync(composePath, "utf-8");
  } catch {
    return {
      success: false,
      service,
      error: `docker-compose.yml not found at ${composePath}. Run 'clawhq init' first.`,
    };
  }

  let compose: Record<string, unknown>;
  try {
    compose = yamlParse(composeRaw) as Record<string, unknown>;
  } catch {
    return {
      success: false,
      service,
      error: `Failed to parse docker-compose.yml. Run 'clawhq doctor --fix' to repair.`,
    };
  }

  // Check if service already exists
  const services = (compose["services"] ?? {}) as Record<string, unknown>;
  if (services[service]) {
    return {
      success: true,
      service,
      composePath,
      envVarsAdded: [],
    };
  }

  // Build service entry for compose
  const port = options.port ?? config.port;
  const serviceEntry: Record<string, unknown> = {
    image: config.image,
    restart: "unless-stopped",
    networks: ["clawhq_net"],
    volumes: [...config.volumes],
    healthcheck: {
      test: ["CMD-SHELL", config.healthcheck.test],
      interval: config.healthcheck.interval,
      timeout: config.healthcheck.timeout,
      retries: config.healthcheck.retries,
    },
    // Expose port only on localhost for security
    ports: [`127.0.0.1:${port}:${config.port}`],
  };

  // Build environment variables
  const envVars = { ...config.envVars, ...options.envOverrides };
  const envVarsAdded: string[] = [];

  // Generate secure password for postgres if needed
  if (service === "postgres" && !envVars["POSTGRES_PASSWORD"]) {
    envVars["POSTGRES_PASSWORD"] = randomBytes(24).toString("base64url");
  }

  // Add env vars to service and .env file
  if (Object.keys(envVars).length > 0) {
    const envEntries: Record<string, string> = {};

    for (const [key, value] of Object.entries(envVars)) {
      // Service container sees the original env var name (e.g. POSTGRES_PASSWORD)
      // ClawHQ .env stores it namespaced (e.g. CLAWHQ_SVC_POSTGRES_PASSWORD)
      const envKey = `CLAWHQ_SVC_${service.toUpperCase()}_${key}`;
      envEntries[key] = `\${${envKey}}`;
      envVarsAdded.push(envKey);

      // Write to .env
      try {
        let envFile = readEnv(envPath);
        envFile = setEnvValue(envFile, envKey, value);
        writeEnvAtomic(envPath, envFile);
      } catch {
        // .env might not exist yet; create it
        const envFile = setEnvValue(parseEnv(""), envKey, value);
        writeEnvAtomic(envPath, envFile);
      }
    }

    serviceEntry["environment"] = envEntries;
  }

  // Add service to compose
  services[service] = serviceEntry;
  compose["services"] = services;

  // Ensure volumes are declared at top level
  const topVolumes = (compose["volumes"] ?? {}) as Record<string, unknown>;
  for (const vol of config.volumes) {
    const volName = vol.split(":")[0];
    if (volName && !topVolumes[volName]) {
      topVolumes[volName] = null;
    }
  }
  compose["volumes"] = topVolumes;

  // Write updated compose
  try {
    writeFileSync(composePath, yamlStringify(compose), "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      service,
      error: `Failed to write docker-compose.yml: ${message}`,
    };
  }

  // Build connection URL for the agent's .env
  // Use the container's internal port (not the host port) since the agent
  // container connects via the Docker network, not via localhost.
  const connectionUrl = buildConnectionUrl(service, envVars, config.port);
  if (connectionUrl) {
    try {
      let envFile: ReturnType<typeof readEnv>;
      try {
        envFile = readEnv(envPath);
      } catch {
        envFile = parseEnv("");
      }
      envFile = setEnvValue(envFile, connectionUrl.key, connectionUrl.value);
      writeEnvAtomic(envPath, envFile);
      envVarsAdded.push(connectionUrl.key);
    } catch {
      // Non-fatal: connection URL is a convenience
    }
  }

  return {
    success: true,
    service,
    composePath,
    envVarsAdded,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a connection URL for the service (for the agent to use). */
function buildConnectionUrl(
  service: ServiceName,
  envVars: Record<string, string>,
  port: number,
): { key: string; value: string } | null {
  switch (service) {
    case "postgres": {
      const user = envVars["POSTGRES_USER"] ?? "clawhq";
      const pass = envVars["POSTGRES_PASSWORD"] ?? "";
      const db = envVars["POSTGRES_DB"] ?? "clawhq";
      return {
        key: "CLAWHQ_POSTGRES_URL",
        value: `postgresql://${user}:${pass}@postgres:${port}/${db}`,
      };
    }
    case "redis":
      return {
        key: "CLAWHQ_REDIS_URL",
        value: `redis://redis:${port}`,
      };
    case "qdrant":
      return {
        key: "CLAWHQ_QDRANT_URL",
        value: `http://qdrant:${port}`,
      };
    default:
      return null;
  }
}

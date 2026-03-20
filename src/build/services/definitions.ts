/**
 * Backing service definitions — postgres, redis, qdrant.
 *
 * Each definition specifies the Docker image, default config,
 * environment variables, volumes, and healthcheck for a backing
 * service that runs alongside the OpenClaw agent container.
 */

import {
  SERVICE_HEALTHCHECK_INTERVAL,
  SERVICE_HEALTHCHECK_RETRIES,
  SERVICE_HEALTHCHECK_TIMEOUT,
  SERVICE_POSTGRES_IMAGE,
  SERVICE_POSTGRES_PORT,
  SERVICE_QDRANT_IMAGE,
  SERVICE_QDRANT_PORT,
  SERVICE_REDIS_IMAGE,
  SERVICE_REDIS_PORT,
} from "../../config/defaults.js";

import type { ServiceConfig, ServiceName } from "./types.js";

// ── Service Catalog ──────────────────────────────────────────────────────────

const POSTGRES: ServiceConfig = {
  name: "postgres",
  image: SERVICE_POSTGRES_IMAGE,
  port: SERVICE_POSTGRES_PORT,
  envVars: {
    POSTGRES_USER: "clawhq",
    POSTGRES_PASSWORD: "",  // Generated at add time
    POSTGRES_DB: "clawhq",
  },
  volumes: ["clawhq_postgres_data:/var/lib/postgresql/data"],
  healthcheck: {
    test: "pg_isready -U clawhq",
    interval: SERVICE_HEALTHCHECK_INTERVAL,
    timeout: SERVICE_HEALTHCHECK_TIMEOUT,
    retries: SERVICE_HEALTHCHECK_RETRIES,
  },
};

const REDIS: ServiceConfig = {
  name: "redis",
  image: SERVICE_REDIS_IMAGE,
  port: SERVICE_REDIS_PORT,
  envVars: {},
  volumes: ["clawhq_redis_data:/data"],
  healthcheck: {
    test: "redis-cli ping",
    interval: SERVICE_HEALTHCHECK_INTERVAL,
    timeout: SERVICE_HEALTHCHECK_TIMEOUT,
    retries: SERVICE_HEALTHCHECK_RETRIES,
  },
};

const QDRANT: ServiceConfig = {
  name: "qdrant",
  image: SERVICE_QDRANT_IMAGE,
  port: SERVICE_QDRANT_PORT,
  envVars: {},
  volumes: ["clawhq_qdrant_data:/qdrant/storage"],
  healthcheck: {
    test: "wget --no-verbose --tries=1 --spider http://localhost:6333/readyz || exit 1",
    interval: SERVICE_HEALTHCHECK_INTERVAL,
    timeout: SERVICE_HEALTHCHECK_TIMEOUT,
    retries: SERVICE_HEALTHCHECK_RETRIES,
  },
};

// ── Catalog Lookup ───────────────────────────────────────────────────────────

const SERVICE_CATALOG: Record<ServiceName, ServiceConfig> = {
  postgres: POSTGRES,
  redis: REDIS,
  qdrant: QDRANT,
};

/** All supported service names. */
export const SUPPORTED_SERVICES: readonly ServiceName[] = Object.keys(SERVICE_CATALOG) as ServiceName[];

/** Get the service definition for a supported backing service. */
export function getServiceConfig(name: ServiceName): ServiceConfig {
  return SERVICE_CATALOG[name];
}

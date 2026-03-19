/**
 * Backing service definitions — postgres, redis, qdrant.
 *
 * Each definition specifies the Docker image, default config,
 * environment variables, volumes, and healthcheck for a backing
 * service that runs alongside the OpenClaw agent container.
 */

import type { ServiceConfig, ServiceName } from "./types.js";

// ── Service Catalog ──────────────────────────────────────────────────────────

const POSTGRES: ServiceConfig = {
  name: "postgres",
  image: "postgres:16-alpine",
  port: 5432,
  envVars: {
    POSTGRES_USER: "clawhq",
    POSTGRES_PASSWORD: "",  // Generated at add time
    POSTGRES_DB: "clawhq",
  },
  volumes: ["clawhq_postgres_data:/var/lib/postgresql/data"],
  healthcheck: {
    test: "pg_isready -U clawhq",
    interval: "10s",
    timeout: "5s",
    retries: 5,
  },
};

const REDIS: ServiceConfig = {
  name: "redis",
  image: "redis:7-alpine",
  port: 6379,
  envVars: {},
  volumes: ["clawhq_redis_data:/data"],
  healthcheck: {
    test: "redis-cli ping",
    interval: "10s",
    timeout: "5s",
    retries: 5,
  },
};

const QDRANT: ServiceConfig = {
  name: "qdrant",
  image: "qdrant/qdrant:v1.12.5",
  port: 6333,
  envVars: {},
  volumes: ["clawhq_qdrant_data:/qdrant/storage"],
  healthcheck: {
    test: "wget --no-verbose --tries=1 --spider http://localhost:6333/readyz || exit 1",
    interval: "10s",
    timeout: "5s",
    retries: 5,
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

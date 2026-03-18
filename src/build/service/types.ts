/**
 * Service management types.
 *
 * Services are backing infrastructure that agents depend on: databases,
 * message queues, vector stores, file storage. ClawHQ manages their
 * lifecycle in docker-compose alongside the agent container.
 */

export interface ServiceHealthCheck {
  /** Command or HTTP endpoint to check health. */
  test: string[];
  interval: string;
  timeout: string;
  retries: number;
}

export interface ServiceDefinition {
  /** Short identifier, e.g. "postgres". */
  name: string;
  /** Docker image reference. */
  image: string;
  /** Environment variables injected into the service container. */
  envVars: Record<string, string>;
  /** Named volumes for persistent data. */
  volumes: string[];
  /** Health check configuration. */
  healthCheck: ServiceHealthCheck;
  /** Ports exposed to the agent network (not host). */
  ports: string[];
  /** Network aliases reachable by the agent container. */
  networkAliases: string[];
  /** Environment variables injected into the agent's .env so it can connect. */
  agentEnvVars: Record<string, string>;
}

export interface ServiceEntry {
  name: string;
  image: string;
  status: "running" | "stopped" | "unknown";
  health: "healthy" | "unhealthy" | "starting" | "none" | "unknown";
}

export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export const BUILTIN_SERVICES: Record<string, ServiceDefinition> = {
  postgres: {
    name: "postgres",
    image: "postgres:16",
    envVars: {
      POSTGRES_PASSWORD: "${CLAWHQ_POSTGRES_PASSWORD:-changeme}",
      POSTGRES_DB: "openclaw",
    },
    volumes: ["clawhq-postgres-data:/var/lib/postgresql/data"],
    healthCheck: {
      test: ["CMD-SHELL", "pg_isready -U postgres"],
      interval: "10s",
      timeout: "5s",
      retries: 5,
    },
    ports: ["5432"],
    networkAliases: ["postgres"],
    agentEnvVars: {
      CLAWHQ_POSTGRES_HOST: "postgres",
      CLAWHQ_POSTGRES_PORT: "5432",
      CLAWHQ_POSTGRES_DB: "openclaw",
      CLAWHQ_POSTGRES_PASSWORD: "changeme",
    },
  },

  redis: {
    name: "redis",
    image: "redis:7",
    envVars: {},
    volumes: ["clawhq-redis-data:/data"],
    healthCheck: {
      test: ["CMD", "redis-cli", "ping"],
      interval: "10s",
      timeout: "5s",
      retries: 5,
    },
    ports: ["6379"],
    networkAliases: ["redis"],
    agentEnvVars: {
      CLAWHQ_REDIS_HOST: "redis",
      CLAWHQ_REDIS_PORT: "6379",
    },
  },

  qdrant: {
    name: "qdrant",
    image: "qdrant/qdrant:latest",
    envVars: {},
    volumes: ["clawhq-qdrant-data:/qdrant/storage"],
    healthCheck: {
      test: ["CMD-SHELL", "curl -sf http://localhost:6333/healthz || exit 1"],
      interval: "10s",
      timeout: "5s",
      retries: 5,
    },
    ports: ["6333"],
    networkAliases: ["qdrant"],
    agentEnvVars: {
      CLAWHQ_QDRANT_HOST: "qdrant",
      CLAWHQ_QDRANT_PORT: "6333",
    },
  },
};

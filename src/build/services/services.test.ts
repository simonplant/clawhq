import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify as yamlStringify, parse as yamlParse } from "yaml";

import { addService } from "./add.js";
import { getServiceConfig, SUPPORTED_SERVICES } from "./definitions.js";
import { listServices } from "./list.js";

// ── Test Fixtures ───────────────────────────────────────────────────────────

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `clawhq-svc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(testDir, "engine"), { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

/** Write a minimal docker-compose.yml for testing. */
async function writeTestCompose(services: Record<string, unknown> = {}) {
  const compose = {
    version: "3.8",
    services: {
      openclaw: {
        image: "clawhq/openclaw:latest",
        networks: ["clawhq_net"],
      },
      ...services,
    },
    networks: { clawhq_net: { driver: "bridge" } },
  };
  await writeFile(
    join(testDir, "engine", "docker-compose.yml"),
    yamlStringify(compose),
    "utf-8",
  );
}

/** Write a minimal .env for testing. */
async function writeTestEnv(content = "GATEWAY_TOKEN=test\n") {
  await writeFile(join(testDir, "engine", ".env"), content, "utf-8");
}

// ── Definition Tests ────────────────────────────────────────────────────────

describe("definitions", () => {
  it("has 3 supported services", () => {
    expect(SUPPORTED_SERVICES).toHaveLength(3);
    expect(SUPPORTED_SERVICES).toContain("postgres");
    expect(SUPPORTED_SERVICES).toContain("redis");
    expect(SUPPORTED_SERVICES).toContain("qdrant");
  });

  it("each service has required fields", () => {
    for (const name of SUPPORTED_SERVICES) {
      const config = getServiceConfig(name);
      expect(config.name).toBe(name);
      expect(config.image).toBeTruthy();
      expect(config.port).toBeGreaterThan(0);
      expect(config.volumes.length).toBeGreaterThan(0);
      expect(config.healthcheck.test).toBeTruthy();
    }
  });
});

// ── Add Service Tests ───────────────────────────────────────────────────────

describe("addService", () => {
  it("fails when docker-compose.yml is missing", async () => {
    const result = await addService({ deployDir: testDir, service: "postgres" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("adds postgres to docker-compose.yml", async () => {
    await writeTestCompose();
    await writeTestEnv();

    const result = await addService({ deployDir: testDir, service: "postgres" });
    expect(result.success).toBe(true);
    expect(result.service).toBe("postgres");

    // Verify compose was updated
    const raw = await readFile(join(testDir, "engine", "docker-compose.yml"), "utf-8");
    const compose = yamlParse(raw) as Record<string, unknown>;
    const services = compose["services"] as Record<string, unknown>;
    expect(services["postgres"]).toBeDefined();

    // Verify healthcheck
    const pg = services["postgres"] as Record<string, unknown>;
    expect(pg["healthcheck"]).toBeDefined();
    expect(pg["image"]).toContain("postgres");
  });

  it("adds redis to docker-compose.yml", async () => {
    await writeTestCompose();
    await writeTestEnv();

    const result = await addService({ deployDir: testDir, service: "redis" });
    expect(result.success).toBe(true);

    const raw = await readFile(join(testDir, "engine", "docker-compose.yml"), "utf-8");
    const compose = yamlParse(raw) as Record<string, unknown>;
    const services = compose["services"] as Record<string, unknown>;
    expect(services["redis"]).toBeDefined();
  });

  it("adds qdrant to docker-compose.yml", async () => {
    await writeTestCompose();
    await writeTestEnv();

    const result = await addService({ deployDir: testDir, service: "qdrant" });
    expect(result.success).toBe(true);

    const raw = await readFile(join(testDir, "engine", "docker-compose.yml"), "utf-8");
    const compose = yamlParse(raw) as Record<string, unknown>;
    const services = compose["services"] as Record<string, unknown>;
    expect(services["qdrant"]).toBeDefined();
  });

  it("is idempotent — adding same service twice succeeds", async () => {
    await writeTestCompose();
    await writeTestEnv();

    const result1 = await addService({ deployDir: testDir, service: "redis" });
    expect(result1.success).toBe(true);

    const result2 = await addService({ deployDir: testDir, service: "redis" });
    expect(result2.success).toBe(true);
    expect(result2.envVarsAdded).toHaveLength(0);
  });

  it("generates a postgres password", async () => {
    await writeTestCompose();
    await writeTestEnv();

    await addService({ deployDir: testDir, service: "postgres" });

    const envContent = await readFile(join(testDir, "engine", ".env"), "utf-8");
    expect(envContent).toContain("CLAWHQ_SVC_POSTGRES_POSTGRES_PASSWORD=");
  });

  it("creates volumes at top level", async () => {
    await writeTestCompose();
    await writeTestEnv();

    await addService({ deployDir: testDir, service: "postgres" });

    const raw = await readFile(join(testDir, "engine", "docker-compose.yml"), "utf-8");
    const compose = yamlParse(raw) as Record<string, unknown>;
    expect(compose["volumes"]).toBeDefined();
    expect(compose["volumes"]).toHaveProperty("clawhq_postgres_data");
  });

  it("binds port to localhost only", async () => {
    await writeTestCompose();
    await writeTestEnv();

    await addService({ deployDir: testDir, service: "redis" });

    const raw = await readFile(join(testDir, "engine", "docker-compose.yml"), "utf-8");
    const compose = yamlParse(raw) as Record<string, unknown>;
    const services = compose["services"] as Record<string, Record<string, unknown>>;
    const ports = services["redis"]["ports"] as string[];
    expect(ports[0]).toMatch(/^127\.0\.0\.1:/);
  });

  it("writes connection URL to .env", async () => {
    await writeTestCompose();
    await writeTestEnv();

    await addService({ deployDir: testDir, service: "postgres" });

    const envContent = await readFile(join(testDir, "engine", ".env"), "utf-8");
    expect(envContent).toContain("CLAWHQ_POSTGRES_URL=");
    expect(envContent).toContain("postgresql://");
  });

  it("respects custom port", async () => {
    await writeTestCompose();
    await writeTestEnv();

    await addService({ deployDir: testDir, service: "redis", port: 16379 });

    const raw = await readFile(join(testDir, "engine", "docker-compose.yml"), "utf-8");
    const compose = yamlParse(raw) as Record<string, unknown>;
    const services = compose["services"] as Record<string, Record<string, unknown>>;
    const ports = services["redis"]["ports"] as string[];
    expect(ports[0]).toContain("16379");
  });
});

// ── List Service Tests ──────────────────────────────────────────────────────

describe("listServices", () => {
  it("returns empty list when no compose file", () => {
    const result = listServices({ deployDir: testDir });
    expect(result.services).toHaveLength(0);
  });

  it("returns empty when no backing services configured", async () => {
    await writeTestCompose();
    const result = listServices({ deployDir: testDir });
    expect(result.services).toHaveLength(0);
  });

  it("lists configured backing services", async () => {
    await writeTestCompose();
    await writeTestEnv();

    await addService({ deployDir: testDir, service: "postgres" });
    await addService({ deployDir: testDir, service: "redis" });

    const result = listServices({ deployDir: testDir });
    expect(result.services).toHaveLength(2);
    expect(result.services.map((s) => s.name)).toContain("postgres");
    expect(result.services.map((s) => s.name)).toContain("redis");
  });
});

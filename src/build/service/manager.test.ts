import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addService,
  formatServiceList,
  listServices,
  removeService,
  resolveService,
} from "./manager.js";
import type { ServiceContext } from "./manager.js";
import { ServiceError } from "./types.js";

const MINIMAL_COMPOSE = `services:
  openclaw:
    image: openclaw:custom
    container_name: openclaw-test
    networks:
      - clawhq
networks:
  clawhq:
    driver: bridge
`;

describe("service manager", () => {
  let tmpDir: string;
  let ctx: ServiceContext;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-service-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    const clawhqDir = join(tmpDir, "clawhq-data");
    await mkdir(clawhqDir, { recursive: true });
    ctx = {
      openclawHome: tmpDir,
      clawhqDir,
    };
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("resolveService", () => {
    it("resolves a known service", () => {
      const def = resolveService("postgres");
      expect(def.name).toBe("postgres");
      expect(def.image).toBe("postgres:16");
    });

    it("throws for unknown service", () => {
      expect(() => resolveService("mysql")).toThrow(ServiceError);
    });
  });

  describe("addService", () => {
    it("adds a service to docker-compose.yml", async () => {
      await writeFile(join(tmpDir, "docker-compose.yml"), MINIMAL_COMPOSE, "utf-8");
      await writeFile(join(tmpDir, ".env"), "# existing\n", "utf-8");

      const result = await addService(ctx, "redis");

      expect(result.definition.name).toBe("redis");

      const compose = await readFile(join(tmpDir, "docker-compose.yml"), "utf-8");
      expect(compose).toContain("clawhq-redis");
      expect(compose).toContain("redis:7");
    });

    it("injects env vars into .env", async () => {
      await writeFile(join(tmpDir, "docker-compose.yml"), MINIMAL_COMPOSE, "utf-8");
      await writeFile(join(tmpDir, ".env"), "# config\n", "utf-8");

      await addService(ctx, "redis");

      const env = await readFile(join(tmpDir, ".env"), "utf-8");
      expect(env).toContain("CLAWHQ_REDIS_HOST=redis");
      expect(env).toContain("CLAWHQ_REDIS_PORT=6379");
    });

    it("creates named volumes", async () => {
      await writeFile(join(tmpDir, "docker-compose.yml"), MINIMAL_COMPOSE, "utf-8");
      await writeFile(join(tmpDir, ".env"), "", "utf-8");

      await addService(ctx, "postgres");

      const compose = await readFile(join(tmpDir, "docker-compose.yml"), "utf-8");
      expect(compose).toContain("clawhq-postgres-data");
    });

    it("throws if service already exists", async () => {
      await writeFile(join(tmpDir, "docker-compose.yml"), MINIMAL_COMPOSE, "utf-8");
      await writeFile(join(tmpDir, ".env"), "", "utf-8");

      await addService(ctx, "redis");
      await expect(addService(ctx, "redis")).rejects.toThrow("already configured");
    });

    it("throws if compose file does not exist", async () => {
      await expect(addService(ctx, "redis")).rejects.toThrow("Cannot read");
    });

    it("joins the agent network", async () => {
      await writeFile(join(tmpDir, "docker-compose.yml"), MINIMAL_COMPOSE, "utf-8");
      await writeFile(join(tmpDir, ".env"), "", "utf-8");

      await addService(ctx, "qdrant");

      const compose = await readFile(join(tmpDir, "docker-compose.yml"), "utf-8");
      expect(compose).toContain("clawhq");
      expect(compose).toContain("qdrant");
    });

    it("adds health check configuration", async () => {
      await writeFile(join(tmpDir, "docker-compose.yml"), MINIMAL_COMPOSE, "utf-8");
      await writeFile(join(tmpDir, ".env"), "", "utf-8");

      await addService(ctx, "postgres");

      const compose = await readFile(join(tmpDir, "docker-compose.yml"), "utf-8");
      expect(compose).toContain("pg_isready");
    });
  });

  describe("removeService", () => {
    it("removes a service from docker-compose.yml", async () => {
      await writeFile(join(tmpDir, "docker-compose.yml"), MINIMAL_COMPOSE, "utf-8");
      await writeFile(join(tmpDir, ".env"), "", "utf-8");

      await addService(ctx, "redis");
      const result = await removeService(ctx, "redis");

      expect(result.definition.name).toBe("redis");
      expect(result.volumesRemoved).toBe(false);

      const compose = await readFile(join(tmpDir, "docker-compose.yml"), "utf-8");
      expect(compose).not.toContain("clawhq-redis:");
    });

    it("preserves data by default", async () => {
      await writeFile(join(tmpDir, "docker-compose.yml"), MINIMAL_COMPOSE, "utf-8");
      await writeFile(join(tmpDir, ".env"), "", "utf-8");

      await addService(ctx, "postgres");
      const result = await removeService(ctx, "postgres");

      expect(result.volumesRemoved).toBe(false);

      const compose = await readFile(join(tmpDir, "docker-compose.yml"), "utf-8");
      expect(compose).toContain("clawhq-postgres-data");
    });

    it("removes volumes with --delete-data", async () => {
      await writeFile(join(tmpDir, "docker-compose.yml"), MINIMAL_COMPOSE, "utf-8");
      await writeFile(join(tmpDir, ".env"), "", "utf-8");

      await addService(ctx, "redis");
      const result = await removeService(ctx, "redis", { deleteData: true });

      expect(result.volumesRemoved).toBe(true);
    });

    it("removes env vars from .env", async () => {
      await writeFile(join(tmpDir, "docker-compose.yml"), MINIMAL_COMPOSE, "utf-8");
      await writeFile(join(tmpDir, ".env"), "", "utf-8");

      await addService(ctx, "redis");
      await removeService(ctx, "redis");

      const env = await readFile(join(tmpDir, ".env"), "utf-8");
      expect(env).not.toContain("CLAWHQ_REDIS_HOST");
    });

    it("throws if service not configured", async () => {
      await writeFile(join(tmpDir, "docker-compose.yml"), MINIMAL_COMPOSE, "utf-8");
      await expect(removeService(ctx, "redis")).rejects.toThrow("not configured");
    });
  });

  describe("listServices", () => {
    it("returns empty array when no services configured", async () => {
      await writeFile(join(tmpDir, "docker-compose.yml"), MINIMAL_COMPOSE, "utf-8");
      const entries = await listServices(ctx);
      expect(entries).toEqual([]);
    });

    it("lists configured services", async () => {
      await writeFile(join(tmpDir, "docker-compose.yml"), MINIMAL_COMPOSE, "utf-8");
      await writeFile(join(tmpDir, ".env"), "", "utf-8");

      await addService(ctx, "redis");
      await addService(ctx, "postgres");

      const entries = await listServices(ctx);
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.name).sort()).toEqual(["postgres", "redis"]);
    });

    it("returns empty when no compose file", async () => {
      const entries = await listServices(ctx);
      expect(entries).toEqual([]);
    });
  });

  describe("formatServiceList", () => {
    it("shows help when empty", () => {
      const out = formatServiceList([]);
      expect(out).toContain("No backing services configured");
      expect(out).toContain("clawhq service add");
    });

    it("formats service entries", () => {
      const out = formatServiceList([
        { name: "redis", image: "redis:7", status: "running", health: "healthy" },
      ]);
      expect(out).toContain("redis");
      expect(out).toContain("redis:7");
      expect(out).toContain("running");
      expect(out).toContain("healthy");
    });
  });
});

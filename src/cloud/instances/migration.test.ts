import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FleetRegistry } from "../fleet/types.js";
import type { InstanceRegistry as LegacyCloudRegistry } from "../provisioning/types.js";

import { migrateLegacyRegistries } from "./migration.js";
import { listInstances, registryPath } from "./registry.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "instances-migration-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function seedCloudDir() {
  mkdirSync(join(root, "cloud"), { recursive: true });
}

function writeFleet(registry: FleetRegistry) {
  seedCloudDir();
  writeFileSync(join(root, "cloud", "fleet.json"), JSON.stringify(registry, null, 2));
}

function writeLegacyCloud(registry: LegacyCloudRegistry) {
  seedCloudDir();
  writeFileSync(join(root, "cloud", "instances.json"), JSON.stringify(registry, null, 2));
}

const cloudNow = "2026-04-20T10:00:00.000Z";

// ── Idempotency ─────────────────────────────────────────────────────────────

describe("migrateLegacyRegistries — idempotency", () => {
  it("is a no-op when instances.json already exists", () => {
    writeFileSync(registryPath(root), JSON.stringify({ version: 1, instances: [] }));
    writeFleet({ version: 1, agents: [{ name: "a", deployDir: "/tmp/a", addedAt: cloudNow }] });

    const result = migrateLegacyRegistries(root);

    expect(result.alreadyMigrated).toBe(true);
    expect(result.migratedFleet).toBe(0);
    expect(existsSync(join(root, "cloud", "fleet.json"))).toBe(true); // untouched
  });

  it("is a no-op when no legacy files exist", () => {
    const result = migrateLegacyRegistries(root);
    expect(result.alreadyMigrated).toBe(false);
    expect(result.migratedFleet).toBe(0);
    expect(result.migratedCloud).toBe(0);
    expect(existsSync(registryPath(root))).toBe(false);
  });
});

// ── Fleet migration ─────────────────────────────────────────────────────────

describe("migrateLegacyRegistries — fleet", () => {
  it("folds fleet entries and mints uuids", () => {
    writeFleet({
      version: 1,
      agents: [
        { name: "clawdius", deployDir: "/home/simon/.clawhq", addedAt: cloudNow },
        { name: "staging", deployDir: "/tmp/staging", addedAt: cloudNow },
      ],
    });

    const result = migrateLegacyRegistries(root);

    expect(result.migratedFleet).toBe(2);
    expect(result.migratedCloud).toBe(0);
    expect(result.renamedForConflict).toEqual([]);

    const instances = listInstances(root);
    expect(instances).toHaveLength(2);
    for (const inst of instances) {
      expect(inst.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(inst.location.kind).toBe("local");
      expect(inst.status).toBe("initialized");
    }
    expect(instances.map((i) => i.name).sort()).toEqual(["clawdius", "staging"]);
  });

  it("renames the legacy fleet file to .migrated.bak", () => {
    writeFleet({ version: 1, agents: [{ name: "a", deployDir: "/tmp/a", addedAt: cloudNow }] });
    migrateLegacyRegistries(root);

    expect(existsSync(join(root, "cloud", "fleet.json"))).toBe(false);
    expect(existsSync(join(root, "cloud", "fleet.json.migrated.bak"))).toBe(true);
  });
});

// ── Cloud migration ─────────────────────────────────────────────────────────

describe("migrateLegacyRegistries — cloud", () => {
  it("folds cloud instances preserving ids", () => {
    writeLegacyCloud({
      version: 1,
      instances: [
        {
          id: "01999999-0000-4000-8000-000000000001",
          name: "prod-a",
          provider: "digitalocean",
          providerInstanceId: "droplet-1",
          ipAddress: "10.0.0.1",
          region: "nyc3",
          size: "s-2vcpu-4gb",
          status: "active",
          createdAt: cloudNow,
          updatedAt: cloudNow,
        },
      ],
    });

    const result = migrateLegacyRegistries(root);
    expect(result.migratedCloud).toBe(1);

    const instances = listInstances(root);
    expect(instances).toHaveLength(1);
    const [only] = instances;
    expect(only?.id).toBe("01999999-0000-4000-8000-000000000001");
    expect(only?.status).toBe("running"); // legacy "active" → "running"
    expect(only?.location.kind).toBe("cloud");
    if (only?.location.kind === "cloud") {
      expect(only.location.providerInstanceId).toBe("droplet-1");
      expect(only.location.region).toBe("nyc3");
    }
  });

  it("maps each legacy status to its unified counterpart", () => {
    const mk = (id: string, status: LegacyCloudRegistry["instances"][number]["status"]) => ({
      id,
      name: `n-${status}`,
      provider: "digitalocean" as const,
      providerInstanceId: `pid-${id.slice(0, 8)}`,
      ipAddress: "10.0.0.1",
      region: "nyc3",
      size: "s-1vcpu-1gb",
      status,
      createdAt: cloudNow,
      updatedAt: cloudNow,
    });

    writeLegacyCloud({
      version: 1,
      instances: [
        mk("00000001-0000-4000-8000-000000000000", "provisioning"),
        mk("00000002-0000-4000-8000-000000000000", "active"),
        mk("00000003-0000-4000-8000-000000000000", "unhealthy"),
        mk("00000004-0000-4000-8000-000000000000", "destroying"),
        mk("00000005-0000-4000-8000-000000000000", "destroyed"),
        mk("00000006-0000-4000-8000-000000000000", "error"),
      ],
    });

    migrateLegacyRegistries(root);
    const byId = Object.fromEntries(listInstances(root).map((i) => [i.id, i.status]));
    expect(byId["00000001-0000-4000-8000-000000000000"]).toBe("initialized");
    expect(byId["00000002-0000-4000-8000-000000000000"]).toBe("running");
    expect(byId["00000003-0000-4000-8000-000000000000"]).toBe("unhealthy");
    expect(byId["00000004-0000-4000-8000-000000000000"]).toBe("running");
    expect(byId["00000005-0000-4000-8000-000000000000"]).toBe("destroyed");
    expect(byId["00000006-0000-4000-8000-000000000000"]).toBe("unhealthy");
  });
});

// ── Combined + collisions ───────────────────────────────────────────────────

describe("migrateLegacyRegistries — both + collisions", () => {
  it("folds both and records name collisions with suffixed fleet entries", () => {
    writeLegacyCloud({
      version: 1,
      instances: [
        {
          id: "01999999-0000-4000-8000-000000000001",
          name: "clawdius",
          provider: "digitalocean",
          providerInstanceId: "droplet-1",
          ipAddress: "10.0.0.1",
          region: "nyc3",
          size: "s-2vcpu-4gb",
          status: "active",
          createdAt: cloudNow,
          updatedAt: cloudNow,
        },
      ],
    });
    writeFleet({
      version: 1,
      agents: [
        { name: "clawdius", deployDir: "/home/simon/.clawhq", addedAt: cloudNow },
        { name: "staging", deployDir: "/tmp/staging", addedAt: cloudNow },
      ],
    });

    const result = migrateLegacyRegistries(root);
    expect(result.migratedCloud).toBe(1);
    expect(result.migratedFleet).toBe(2);
    expect(result.renamedForConflict).toHaveLength(1);
    expect(result.renamedForConflict[0]).toMatch(/^clawdius → clawdius-local-[0-9a-f]{6}$/);

    const names = listInstances(root).map((i) => i.name).sort();
    expect(names).toHaveLength(3);
    expect(names).toContain("clawdius"); // cloud keeps the canonical name
    expect(names).toContain("staging");
    expect(names.some((n) => /^clawdius-local-[0-9a-f]{6}$/.test(n))).toBe(true);
  });

  it("renames both legacy files to .migrated.bak on combined migration", () => {
    writeFleet({ version: 1, agents: [{ name: "a", deployDir: "/tmp/a", addedAt: cloudNow }] });
    writeLegacyCloud({
      version: 1,
      instances: [
        {
          id: "01999999-0000-4000-8000-000000000001",
          name: "b",
          provider: "digitalocean",
          providerInstanceId: "droplet-b",
          ipAddress: "10.0.0.2",
          region: "nyc3",
          size: "s-2vcpu-4gb",
          status: "active",
          createdAt: cloudNow,
          updatedAt: cloudNow,
        },
      ],
    });

    migrateLegacyRegistries(root);

    expect(existsSync(join(root, "cloud", "fleet.json"))).toBe(false);
    expect(existsSync(join(root, "cloud", "fleet.json.migrated.bak"))).toBe(true);
    expect(existsSync(join(root, "cloud", "instances.json"))).toBe(false);
    expect(existsSync(join(root, "cloud", "instances.json.migrated.bak"))).toBe(true);
  });
});

// ── Robustness ──────────────────────────────────────────────────────────────

describe("migrateLegacyRegistries — robustness", () => {
  it("ignores malformed legacy files", () => {
    seedCloudDir();
    writeFileSync(join(root, "cloud", "fleet.json"), "garbage{{");
    const result = migrateLegacyRegistries(root);
    expect(result.migratedFleet).toBe(0);
    expect(existsSync(registryPath(root))).toBe(false);
    // Malformed file left in place (caller can inspect).
    expect(existsSync(join(root, "cloud", "fleet.json"))).toBe(true);
  });

  it("ignores legacy files with unexpected version", () => {
    seedCloudDir();
    writeFileSync(
      join(root, "cloud", "fleet.json"),
      JSON.stringify({ version: 99, agents: [] }),
    );
    const result = migrateLegacyRegistries(root);
    expect(result.migratedFleet).toBe(0);
    expect(existsSync(registryPath(root))).toBe(false);
  });
});

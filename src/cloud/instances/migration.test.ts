import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FleetRegistry } from "../fleet/types.js";
import type { InstanceRegistry as LegacyCloudRegistry } from "../provisioning/types.js";

import { migrateLegacyRegistries, migrateOpsState } from "./migration.js";
import { addInstance, listInstances, registryPath } from "./registry.js";

let root: string;
let homeSandbox: string;
let originalHome: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "instances-migration-test-"));
  homeSandbox = mkdtempSync(join(tmpdir(), "instances-migration-home-"));
  originalHome = process.env["HOME"];
  process.env["HOME"] = homeSandbox;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = originalHome;
  rmSync(root, { recursive: true, force: true });
  rmSync(homeSandbox, { recursive: true, force: true });
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

// ── Ops-state migration (FEAT-190) ──────────────────────────────────────────

describe("migrateOpsState", () => {
  it("moves ${deployDir}/ops/ → ~/.clawhq/instances/<id>/ops/", () => {
    const deployDir = mkdtempSync(join(tmpdir(), "ops-state-deploy-"));
    try {
      const legacyOps = join(deployDir, "ops");
      mkdirSync(join(legacyOps, "firewall"), { recursive: true });
      writeFileSync(join(legacyOps, "firewall", "allowlist.yaml"), "# seed\n");

      const inst = addInstance(
        { name: "clawdius", status: "running", location: { kind: "local", deployDir } },
        homeSandbox ? join(homeSandbox, ".clawhq") : undefined,
      );
      mkdirSync(join(homeSandbox, ".clawhq"), { recursive: true });
      // Re-seed registry at the sandbox-home location.
      addInstance(
        { id: inst.id, name: "clawdius-sandbox", status: "running", location: { kind: "local", deployDir } },
        join(homeSandbox, ".clawhq"),
      );

      const result = migrateOpsState(join(homeSandbox, ".clawhq"));

      expect(result.moved).toContain(inst.id);
      expect(existsSync(legacyOps)).toBe(false);
      const targetAllowlist = join(
        homeSandbox,
        ".clawhq",
        "instances",
        inst.id,
        "ops",
        "firewall",
        "allowlist.yaml",
      );
      expect(existsSync(targetAllowlist)).toBe(true);
    } finally {
      rmSync(deployDir, { recursive: true, force: true });
    }
  });

  it("is idempotent — second call reports alreadyMoved", () => {
    const deployDir = mkdtempSync(join(tmpdir(), "ops-state-deploy-"));
    try {
      mkdirSync(join(deployDir, "ops"), { recursive: true });
      const inst = addInstance(
        { name: "a", status: "running", location: { kind: "local", deployDir } },
        join(homeSandbox, ".clawhq"),
      );

      migrateOpsState(join(homeSandbox, ".clawhq"));
      const second = migrateOpsState(join(homeSandbox, ".clawhq"));
      expect(second.alreadyMoved).toContain(inst.id);
      expect(second.moved).toHaveLength(0);
    } finally {
      rmSync(deployDir, { recursive: true, force: true });
    }
  });

  it("skips instances with no legacy ops dir", () => {
    const deployDir = mkdtempSync(join(tmpdir(), "ops-state-deploy-"));
    try {
      // No ops dir created.
      const inst = addInstance(
        { name: "a", status: "initialized", location: { kind: "local", deployDir } },
        join(homeSandbox, ".clawhq"),
      );
      const result = migrateOpsState(join(homeSandbox, ".clawhq"));
      expect(result.nothingToMove).toContain(inst.id);
    } finally {
      rmSync(deployDir, { recursive: true, force: true });
    }
  });

  it("ignores cloud instances", () => {
    const result = migrateOpsState(join(homeSandbox, ".clawhq"));
    // Empty registry → no cloud instances → empty result arrays.
    expect(result.moved).toEqual([]);
    expect(result.alreadyMoved).toEqual([]);
    expect(result.nothingToMove).toEqual([]);
  });
});

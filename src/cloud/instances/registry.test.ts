import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addInstance,
  findById,
  findByIdPrefix,
  findByName,
  listInstances,
  readRegistry,
  registryPath,
  removeInstance,
  updateInstance,
} from "./registry.js";
import {
  AmbiguousInstancePrefixError,
  DuplicateInstanceNameError,
  type AddInstanceOptions,
} from "./types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "instances-registry-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function localInput(name: string, deployDir = "/tmp/fake"): AddInstanceOptions {
  return {
    name,
    status: "initialized",
    location: { kind: "local", deployDir },
  };
}

function cloudInput(name: string): AddInstanceOptions {
  return {
    name,
    status: "running",
    blueprint: "email-manager",
    location: {
      kind: "cloud",
      provider: "digitalocean",
      providerInstanceId: "droplet-12345",
      ipAddress: "143.198.12.45",
      region: "nyc3",
      size: "s-2vcpu-4gb",
    },
  };
}

// ── Read ────────────────────────────────────────────────────────────────────

describe("readRegistry", () => {
  it("returns empty registry when file does not exist", () => {
    const reg = readRegistry(root);
    expect(reg).toEqual({ version: 1, instances: [] });
  });

  it("returns empty registry when file is malformed JSON", () => {
    writeFileSync(registryPath(root), "not-json", { mode: 0o600 });
    const reg = readRegistry(root);
    expect(reg.instances).toEqual([]);
  });

  it("returns empty registry when version is unexpected", () => {
    writeFileSync(
      registryPath(root),
      JSON.stringify({ version: 99, instances: [] }),
      { mode: 0o600 },
    );
    expect(readRegistry(root).instances).toEqual([]);
  });
});

// ── Add ─────────────────────────────────────────────────────────────────────

describe("addInstance", () => {
  it("adds a local instance and mints a uuid", () => {
    const inst = addInstance(localInput("clawdius"), root);
    expect(inst.name).toBe("clawdius");
    expect(inst.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(inst.location.kind).toBe("local");
    expect(inst.createdAt).toEqual(inst.updatedAt);
  });

  it("adds a cloud instance with full location", () => {
    const inst = addInstance(cloudInput("prod-a1"), root);
    expect(inst.location.kind).toBe("cloud");
    if (inst.location.kind === "cloud") {
      expect(inst.location.providerInstanceId).toBe("droplet-12345");
      expect(inst.location.ipAddress).toBe("143.198.12.45");
    }
    expect(inst.blueprint).toBe("email-manager");
  });

  it("round-trips through disk", () => {
    const written = addInstance(localInput("a"), root);
    const read = findById(written.id, root);
    expect(read).toEqual(written);
  });

  it("rejects a duplicate name", () => {
    addInstance(localInput("clawdius"), root);
    expect(() => addInstance(localInput("clawdius", "/tmp/other"), root)).toThrow(
      DuplicateInstanceNameError,
    );
  });

  it("accepts an explicit id (migration path)", () => {
    const explicit = "01955000-0000-4000-8000-000000000001";
    const inst = addInstance({ ...localInput("a"), id: explicit }, root);
    expect(inst.id).toBe(explicit);
  });

  it("writes the registry file with mode 0600", () => {
    addInstance(localInput("a"), root);
    const mode = statSync(registryPath(root)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("does not leave tmp files behind on success", () => {
    addInstance(localInput("a"), root);
    const leftovers = readdirSync(root).filter((n) => n.startsWith(".instances.tmp."));
    expect(leftovers).toEqual([]);
  });
});

// ── Update ──────────────────────────────────────────────────────────────────

describe("updateInstance", () => {
  it("patches status and refreshes updatedAt", async () => {
    const created = addInstance(localInput("a"), root);
    await new Promise((r) => setTimeout(r, 5));
    const updated = updateInstance(created.id, { status: "running" }, root);
    expect(updated?.status).toBe("running");
    expect(updated?.updatedAt).not.toBe(created.updatedAt);
    expect(updated?.createdAt).toBe(created.createdAt);
  });

  it("returns undefined for unknown id", () => {
    expect(updateInstance("missing", { status: "running" }, root)).toBeUndefined();
  });

  it("rejects a name change that would collide", () => {
    const a = addInstance(localInput("a"), root);
    addInstance(localInput("b", "/tmp/b"), root);
    expect(() => updateInstance(a.id, { name: "b" }, root)).toThrow(DuplicateInstanceNameError);
  });

  it("allows renaming to an unused name", () => {
    const a = addInstance(localInput("a"), root);
    const renamed = updateInstance(a.id, { name: "new-a" }, root);
    expect(renamed?.name).toBe("new-a");
  });
});

// ── Remove ──────────────────────────────────────────────────────────────────

describe("removeInstance", () => {
  it("removes an existing id and returns true", () => {
    const a = addInstance(localInput("a"), root);
    expect(removeInstance(a.id, root)).toBe(true);
    expect(findById(a.id, root)).toBeUndefined();
  });

  it("returns false when id is absent", () => {
    expect(removeInstance("nope", root)).toBe(false);
  });
});

// ── Queries ─────────────────────────────────────────────────────────────────

describe("findByName", () => {
  it("returns the instance matching a name", () => {
    addInstance(localInput("a"), root);
    const b = addInstance(localInput("b", "/tmp/b"), root);
    expect(findByName("b", root)?.id).toBe(b.id);
  });

  it("returns undefined when no match", () => {
    expect(findByName("nope", root)).toBeUndefined();
  });
});

describe("findByIdPrefix", () => {
  it("returns undefined for prefixes shorter than the minimum", () => {
    addInstance(
      { ...localInput("a"), id: "01955000-0000-4000-8000-000000000001" },
      root,
    );
    expect(findByIdPrefix("019", root)).toBeUndefined();
    expect(findByIdPrefix("01", root)).toBeUndefined();
  });

  it("returns the unique match for a valid unambiguous prefix", () => {
    const a = addInstance(
      { ...localInput("a"), id: "01955000-0000-4000-8000-000000000001" },
      root,
    );
    addInstance(
      {
        ...localInput("b", "/tmp/b"),
        id: "01966000-0000-4000-8000-000000000002",
      },
      root,
    );
    expect(findByIdPrefix("01955000", root)?.id).toBe(a.id);
  });

  it("throws AmbiguousInstancePrefixError when multiple ids share the prefix", () => {
    addInstance(
      { ...localInput("a"), id: "01955000-0000-4000-8000-000000000001" },
      root,
    );
    addInstance(
      {
        ...localInput("b", "/tmp/b"),
        id: "01955000-0000-4000-8000-000000000002",
      },
      root,
    );
    expect(() => findByIdPrefix("01955000", root)).toThrow(AmbiguousInstancePrefixError);
  });

  it("returns undefined when nothing matches", () => {
    addInstance(localInput("a"), root);
    expect(findByIdPrefix("zzzzzzzz", root)).toBeUndefined();
  });
});

describe("listInstances", () => {
  it("returns instances in insertion order", () => {
    addInstance(localInput("a"), root);
    addInstance(localInput("b", "/tmp/b"), root);
    addInstance(localInput("c", "/tmp/c"), root);
    expect(listInstances(root).map((i) => i.name)).toEqual(["a", "b", "c"]);
  });
});

// ── File shape ──────────────────────────────────────────────────────────────

describe("persistence", () => {
  it("writes valid JSON with trailing newline", () => {
    addInstance(localInput("a"), root);
    const raw = readFileSync(registryPath(root), "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(Array.isArray(parsed.instances)).toBe(true);
  });

  it("does not create the file for read-only calls", () => {
    void readRegistry(root);
    void listInstances(root);
    void findById("x", root);
    expect(existsSync(registryPath(root))).toBe(false);
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeCurrentPointer } from "./pointer.js";
import { addInstance } from "./registry.js";
import {
  AmbiguousInstancePrefixError,
  InstanceNotFoundError,
  InstanceSelectorRequiredError,
  NoInstancesRegisteredError,
  resolveInstance,
} from "./resolver.js";
import type { AddInstanceOptions } from "./types.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "instances-resolver-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function local(name: string, deployDir: string, id?: string): AddInstanceOptions {
  return {
    name,
    status: "initialized",
    location: { kind: "local", deployDir },
    ...(id ? { id } : {}),
  };
}

// ── Explicit selector ───────────────────────────────────────────────────────

describe("resolveInstance — explicit selector (--agent)", () => {
  it("resolves by name", () => {
    const a = addInstance(local("clawdius", "/tmp/clawdius"), root);
    const res = resolveInstance({ selector: "clawdius", env: {}, cwd: "/", root });
    expect(res.instance.id).toBe(a.id);
    expect(res.source).toBe("selector");
  });

  it("resolves by id-prefix", () => {
    const a = addInstance(
      local("clawdius", "/tmp/clawdius", "01955000-0000-4000-8000-000000000001"),
      root,
    );
    const res = resolveInstance({ selector: "01955000", env: {}, cwd: "/", root });
    expect(res.instance.id).toBe(a.id);
  });

  it("resolves by full id", () => {
    const a = addInstance(
      local("clawdius", "/tmp/clawdius", "01955000-0000-4000-8000-000000000001"),
      root,
    );
    const res = resolveInstance({ selector: a.id, env: {}, cwd: "/", root });
    expect(res.instance.id).toBe(a.id);
  });

  it("throws InstanceNotFoundError when selector matches nothing", () => {
    addInstance(local("a", "/tmp/a"), root);
    expect(() => resolveInstance({ selector: "nope", env: {}, cwd: "/", root })).toThrow(
      InstanceNotFoundError,
    );
  });

  it("propagates AmbiguousInstancePrefixError on ambiguous id prefix", () => {
    addInstance(local("a", "/tmp/a", "01955000-0000-4000-8000-000000000001"), root);
    addInstance(local("b", "/tmp/b", "01955000-0000-4000-8000-000000000002"), root);
    expect(() => resolveInstance({ selector: "01955000", env: {}, cwd: "/", root })).toThrow(
      AmbiguousInstancePrefixError,
    );
  });
});

// ── Env var ─────────────────────────────────────────────────────────────────

describe("resolveInstance — CLAWHQ_AGENT env var", () => {
  it("uses env var when selector is absent", () => {
    const a = addInstance(local("clawdius", "/tmp/clawdius"), root);
    const res = resolveInstance({
      env: { CLAWHQ_AGENT: "clawdius" },
      cwd: "/",
      root,
    });
    expect(res.instance.id).toBe(a.id);
    expect(res.source).toBe("env");
  });

  it("explicit selector beats env", () => {
    const a = addInstance(local("a", "/tmp/a"), root);
    addInstance(local("b", "/tmp/b"), root);
    const res = resolveInstance({
      selector: "a",
      env: { CLAWHQ_AGENT: "b" },
      cwd: "/",
      root,
    });
    expect(res.instance.id).toBe(a.id);
    expect(res.source).toBe("selector");
  });

  it("throws when env value does not match", () => {
    addInstance(local("a", "/tmp/a"), root);
    expect(() =>
      resolveInstance({ env: { CLAWHQ_AGENT: "missing" }, cwd: "/", root }),
    ).toThrow(InstanceNotFoundError);
  });
});

// ── Pointer file ────────────────────────────────────────────────────────────

describe("resolveInstance — current pointer", () => {
  it("uses ~/.clawhq/current when no selector or env", () => {
    const a = addInstance(local("clawdius", "/tmp/clawdius"), root);
    writeCurrentPointer("clawdius", root);
    const res = resolveInstance({ env: {}, cwd: "/", root });
    expect(res.instance.id).toBe(a.id);
    expect(res.source).toBe("current");
  });

  it("env beats current pointer", () => {
    const a = addInstance(local("a", "/tmp/a"), root);
    addInstance(local("b", "/tmp/b"), root);
    writeCurrentPointer("b", root);
    const res = resolveInstance({ env: { CLAWHQ_AGENT: "a" }, cwd: "/", root });
    expect(res.instance.id).toBe(a.id);
    expect(res.source).toBe("env");
  });
});

// ── cwd walk ────────────────────────────────────────────────────────────────

describe("resolveInstance — cwd walk-up", () => {
  it("matches a registered local deployDir found by walking up", () => {
    const deployDir = mkdtempSync(join(tmpdir(), "cwd-resolver-deploy-"));
    try {
      writeFileSync(join(deployDir, "clawhq.yaml"), "# marker\n");
      const a = addInstance(local("clawdius", deployDir), root);
      // cwd is a subdirectory under deployDir
      const sub = join(deployDir, "engine");
      mkdirSync(sub, { recursive: true });
      const res = resolveInstance({ env: {}, cwd: sub, root });
      expect(res.instance.id).toBe(a.id);
      expect(res.source).toBe("cwd");
    } finally {
      rmSync(deployDir, { recursive: true, force: true });
    }
  });

  it("falls through to single-default when clawhq.yaml has no matching registry entry", () => {
    const projDir = mkdtempSync(join(tmpdir(), "cwd-resolver-unreg-"));
    try {
      writeFileSync(join(projDir, "clawhq.yaml"), "# marker\n");
      const only = addInstance(local("other", "/tmp/other"), root);
      const res = resolveInstance({ env: {}, cwd: projDir, root });
      expect(res.instance.id).toBe(only.id);
      expect(res.source).toBe("single-default");
    } finally {
      rmSync(projDir, { recursive: true, force: true });
    }
  });

  it("errors on ambiguity when cwd has no clawhq.yaml and >1 registered", () => {
    addInstance(local("a", "/tmp/a"), root);
    addInstance(local("b", "/tmp/b"), root);
    expect(() => resolveInstance({ env: {}, cwd: "/", root })).toThrow(
      InstanceSelectorRequiredError,
    );
  });
});

// ── Single default ──────────────────────────────────────────────────────────

describe("resolveInstance — single-default fallback", () => {
  it("returns the only registered instance when nothing else matches", () => {
    const a = addInstance(local("only", "/tmp/only"), root);
    const res = resolveInstance({ env: {}, cwd: "/", root });
    expect(res.instance.id).toBe(a.id);
    expect(res.source).toBe("single-default");
  });

  it("throws NoInstancesRegisteredError on empty registry", () => {
    expect(() => resolveInstance({ env: {}, cwd: "/", root })).toThrow(
      NoInstancesRegisteredError,
    );
  });

  it("throws InstanceSelectorRequiredError with >1 entries", () => {
    addInstance(local("a", "/tmp/a"), root);
    addInstance(local("b", "/tmp/b"), root);
    try {
      resolveInstance({ env: {}, cwd: "/", root });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InstanceSelectorRequiredError);
      if (err instanceof InstanceSelectorRequiredError) {
        expect(err.registeredNames).toEqual(["a", "b"]);
      }
    }
  });
});

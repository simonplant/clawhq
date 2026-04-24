import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { addInstance } from "../cloud/instances/index.js";

import {
  DeployDirAmbiguousError,
  InstanceNotFoundError,
  extractAgentSelector,
  resolveDeployDirFromContext,
} from "./resolve-deploy-dir.js";

let registryRoot: string;
let workDir: string;

beforeEach(() => {
  registryRoot = mkdtempSync(join(tmpdir(), "resolve-deploy-dir-reg-"));
  workDir = mkdtempSync(join(tmpdir(), "resolve-deploy-dir-work-"));
});

afterEach(() => {
  rmSync(registryRoot, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
});

// ── extractAgentSelector ────────────────────────────────────────────────────

describe("extractAgentSelector", () => {
  it("picks up --agent <name>", () => {
    expect(extractAgentSelector(["node", "clawhq", "doctor", "--agent", "clawdius"])).toBe(
      "clawdius",
    );
  });

  it("picks up --agent=<name>", () => {
    expect(extractAgentSelector(["node", "clawhq", "--agent=prod", "doctor"])).toBe("prod");
  });

  it("returns undefined when not present", () => {
    expect(extractAgentSelector(["node", "clawhq", "doctor"])).toBeUndefined();
  });

  it("returns undefined when value starts with a dash (missing arg)", () => {
    expect(extractAgentSelector(["node", "clawhq", "--agent", "--verbose"])).toBeUndefined();
  });
});

// ── resolveDeployDirFromContext ─────────────────────────────────────────────

describe("resolveDeployDirFromContext — --agent flag", () => {
  it("resolves --agent via the registry to the target deployDir", () => {
    const deployDir = join(workDir, "a-deploy");
    mkdirSync(deployDir);
    addInstance(
      { name: "agent-a", status: "initialized", location: { kind: "local", deployDir } },
      registryRoot,
    );

    const result = resolveDeployDirFromContext({
      argv: ["node", "clawhq", "doctor", "--agent", "agent-a"],
      env: {},
      cwd: "/",
      registryRoot,
    });

    expect(result.source).toBe("agent-flag");
    expect(result.deployDir).toBe(deployDir);
    expect(result.instanceId).toBeDefined();
  });

  it("throws InstanceNotFoundError for --agent that does not exist", () => {
    expect(() =>
      resolveDeployDirFromContext({
        argv: ["clawhq", "--agent", "missing"],
        env: {},
        cwd: "/",
        registryRoot,
      }),
    ).toThrow(InstanceNotFoundError);
  });
});

// ── env override ────────────────────────────────────────────────────────────

describe("resolveDeployDirFromContext — CLAWHQ_DEPLOY_DIR", () => {
  it("returns the env value when set and no --agent", () => {
    const result = resolveDeployDirFromContext({
      argv: ["clawhq", "doctor"],
      env: { CLAWHQ_DEPLOY_DIR: "/custom/path" },
      cwd: "/",
      registryRoot,
    });
    expect(result.deployDir).toBe("/custom/path");
    expect(result.source).toBe("env");
  });
});

// ── cwd walk ────────────────────────────────────────────────────────────────

describe("resolveDeployDirFromContext — cwd walk", () => {
  it("uses the registered instance when cwd contains its clawhq.yaml", () => {
    const deployDir = join(workDir, "tenant-a");
    mkdirSync(deployDir);
    writeFileSync(join(deployDir, "clawhq.yaml"), "instanceName: tenant-a\n");
    addInstance(
      {
        name: "tenant-a",
        status: "initialized",
        location: { kind: "local", deployDir },
      },
      registryRoot,
    );

    const sub = join(deployDir, "engine");
    mkdirSync(sub);

    const result = resolveDeployDirFromContext({
      argv: ["clawhq", "doctor"],
      env: {},
      cwd: sub,
      registryRoot,
    });

    expect(result.source).toBe("cwd-walk");
    expect(result.deployDir).toBe(deployDir);
  });

  it("resolves by instanceId when the yaml carries one", () => {
    const deployDir = join(workDir, "tenant-b");
    mkdirSync(deployDir);
    const inst = addInstance(
      {
        name: "tenant-b",
        status: "initialized",
        location: { kind: "local", deployDir },
      },
      registryRoot,
    );
    writeFileSync(join(deployDir, "clawhq.yaml"), `instanceId: ${inst.id}\n`);

    const result = resolveDeployDirFromContext({
      argv: ["clawhq", "doctor"],
      env: {},
      cwd: deployDir,
      registryRoot,
    });
    expect(result.source).toBe("cwd-walk");
    expect(result.instanceId).toBe(inst.id);
  });

  it("uses the walked-up dir with a warning when clawhq.yaml is unregistered", () => {
    const deployDir = join(workDir, "stray");
    mkdirSync(deployDir);
    writeFileSync(join(deployDir, "clawhq.yaml"), "# no instanceId\n");

    const result = resolveDeployDirFromContext({
      argv: ["clawhq", "doctor"],
      env: {},
      cwd: deployDir,
      registryRoot,
    });
    expect(result.source).toBe("cwd-walk");
    expect(result.deployDir).toBe(deployDir);
    expect(result.warning).toMatch(/not in the instance registry/);
  });
});

// ── Single registered ───────────────────────────────────────────────────────

describe("resolveDeployDirFromContext — single-registered", () => {
  it("returns the only registered instance when cwd has no clawhq.yaml", () => {
    const deployDir = join(workDir, "only");
    mkdirSync(deployDir);
    const inst = addInstance(
      {
        name: "only",
        status: "initialized",
        location: { kind: "local", deployDir },
      },
      registryRoot,
    );
    const result = resolveDeployDirFromContext({
      argv: ["clawhq", "doctor"],
      env: {},
      cwd: "/",
      registryRoot,
    });
    expect(result.source).toBe("single-registered");
    expect(result.deployDir).toBe(deployDir);
    expect(result.instanceId).toBe(inst.id);
  });
});

// ── Ambiguity ───────────────────────────────────────────────────────────────

describe("resolveDeployDirFromContext — ambiguity", () => {
  it("throws DeployDirAmbiguousError on multiple registered + no selector", () => {
    addInstance(
      { name: "a", status: "initialized", location: { kind: "local", deployDir: join(workDir, "a") } },
      registryRoot,
    );
    addInstance(
      { name: "b", status: "initialized", location: { kind: "local", deployDir: join(workDir, "b") } },
      registryRoot,
    );

    try {
      resolveDeployDirFromContext({
        argv: ["clawhq", "doctor"],
        env: {},
        cwd: "/",
        registryRoot,
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(DeployDirAmbiguousError);
      if (err instanceof DeployDirAmbiguousError) {
        expect(err.registeredNames).toEqual(["a", "b"]);
      }
    }
  });

  it("does NOT throw ambiguous when --agent resolves unambiguously", () => {
    const a = join(workDir, "a");
    mkdirSync(a);
    addInstance(
      { name: "a", status: "initialized", location: { kind: "local", deployDir: a } },
      registryRoot,
    );
    addInstance(
      { name: "b", status: "initialized", location: { kind: "local", deployDir: join(workDir, "b") } },
      registryRoot,
    );

    const result = resolveDeployDirFromContext({
      argv: ["clawhq", "--agent", "a", "doctor"],
      env: {},
      cwd: "/",
      registryRoot,
    });
    expect(result.deployDir).toBe(a);
  });
});

// ── Fallback ────────────────────────────────────────────────────────────────

describe("resolveDeployDirFromContext — fresh install fallback", () => {
  it("returns ~/.clawhq when registry is empty and no clawhq.yaml is reachable", () => {
    const result = resolveDeployDirFromContext({
      argv: ["clawhq", "install"],
      env: {},
      cwd: "/",
      registryRoot,
    });
    expect(result.source).toBe("fallback");
    expect(result.deployDir).toMatch(/\.clawhq$/);
  });
});

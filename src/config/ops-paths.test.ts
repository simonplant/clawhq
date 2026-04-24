import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  instanceOpsDir,
  legacyOpsDir,
  opsPath,
  readInstanceIdFromDeploy,
} from "./ops-paths.js";

let homeSandbox: string;
let originalHome: string | undefined;
let deployDir: string;

beforeEach(() => {
  homeSandbox = mkdtempSync(join(tmpdir(), "ops-paths-home-"));
  originalHome = process.env["HOME"];
  process.env["HOME"] = homeSandbox;
  deployDir = mkdtempSync(join(tmpdir(), "ops-paths-deploy-"));
});

afterEach(() => {
  if (originalHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = originalHome;
  rmSync(homeSandbox, { recursive: true, force: true });
  rmSync(deployDir, { recursive: true, force: true });
});

describe("instanceOpsDir", () => {
  it("points into ~/.clawhq/instances/<id>/ops/", () => {
    const id = "01955000-0000-4000-8000-000000000001";
    expect(instanceOpsDir(id)).toBe(join(homeSandbox, ".clawhq", "instances", id, "ops"));
    expect(instanceOpsDir(id, "firewall", "allowlist.yaml")).toBe(
      join(homeSandbox, ".clawhq", "instances", id, "ops", "firewall", "allowlist.yaml"),
    );
  });
});

describe("legacyOpsDir", () => {
  it("points into ${deployDir}/ops/", () => {
    expect(legacyOpsDir("/some/deploy")).toBe("/some/deploy/ops");
    expect(legacyOpsDir("/some/deploy", "audit")).toBe("/some/deploy/ops/audit");
  });
});

describe("readInstanceIdFromDeploy", () => {
  it("returns undefined when clawhq.yaml is missing", () => {
    expect(readInstanceIdFromDeploy(deployDir)).toBeUndefined();
  });

  it("returns undefined when the file lacks instanceId", () => {
    writeFileSync(join(deployDir, "clawhq.yaml"), "instanceName: clawdius\n");
    expect(readInstanceIdFromDeploy(deployDir)).toBeUndefined();
  });

  it("returns undefined for malformed yaml", () => {
    writeFileSync(join(deployDir, "clawhq.yaml"), "{{{not yaml");
    expect(readInstanceIdFromDeploy(deployDir)).toBeUndefined();
  });

  it("returns the id when present", () => {
    const id = "01955000-0000-4000-8000-000000000001";
    writeFileSync(join(deployDir, "clawhq.yaml"), `instanceId: ${id}\ninstanceName: clawdius\n`);
    expect(readInstanceIdFromDeploy(deployDir)).toBe(id);
  });
});

describe("opsPath", () => {
  it("returns the legacy path when clawhq.yaml has no instanceId", () => {
    // No clawhq.yaml at all
    expect(opsPath(deployDir)).toBe(join(deployDir, "ops"));
    expect(opsPath(deployDir, "audit")).toBe(join(deployDir, "ops", "audit"));
  });

  it("returns the instance-scoped path when clawhq.yaml has an instanceId", () => {
    const id = "01955000-0000-4000-8000-000000000001";
    writeFileSync(join(deployDir, "clawhq.yaml"), `instanceId: ${id}\n`);
    expect(opsPath(deployDir)).toBe(
      join(homeSandbox, ".clawhq", "instances", id, "ops"),
    );
    expect(opsPath(deployDir, "firewall", "allowlist.yaml")).toBe(
      join(homeSandbox, ".clawhq", "instances", id, "ops", "firewall", "allowlist.yaml"),
    );
  });

  it("joins extra path segments correctly for both paths", () => {
    // No instanceId → legacy
    expect(opsPath(deployDir, "a", "b", "c")).toBe(join(deployDir, "ops", "a", "b", "c"));

    // With instanceId → instance-scoped
    const id = "01966000-0000-4000-8000-000000000002";
    mkdirSync(join(deployDir, "sub"), { recursive: true });
    writeFileSync(join(deployDir, "clawhq.yaml"), `instanceId: ${id}\n`);
    expect(opsPath(deployDir, "a", "b", "c")).toBe(
      join(homeSandbox, ".clawhq", "instances", id, "ops", "a", "b", "c"),
    );
  });
});

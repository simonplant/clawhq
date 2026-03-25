/**
 * Version validation tests for evolve manifests that lack dedicated test files.
 *
 * Covers: integration, provider, and role manifests.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadIntegrationManifest } from "./integrate/manifest.js";
import { loadProviderManifest } from "./provider/manifest.js";
import { loadRoleManifest } from "./role/manifest.js";

function tmpDeployDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "clawhq-manifest-ver-test-"));
  mkdirSync(join(dir, "ops", "integrations"), { recursive: true });
  mkdirSync(join(dir, "ops", "providers"), { recursive: true });
  mkdirSync(join(dir, "ops", "roles"), { recursive: true });
  return dir;
}

describe("integration manifest version validation", () => {
  it("throws on unsupported version", () => {
    const deployDir = tmpDeployDir();
    writeFileSync(
      join(deployDir, "ops", "integrations", ".integration-manifest.json"),
      JSON.stringify({ version: 2, integrations: [] }),
    );
    expect(() => loadIntegrationManifest(deployDir)).toThrow(
      /Unsupported integration manifest version 2 \(expected 1\)/,
    );
  });

  it("throws on missing version field", () => {
    const deployDir = tmpDeployDir();
    writeFileSync(
      join(deployDir, "ops", "integrations", ".integration-manifest.json"),
      JSON.stringify({ integrations: [] }),
    );
    expect(() => loadIntegrationManifest(deployDir)).toThrow(
      /Unsupported integration manifest version undefined \(expected 1\)/,
    );
  });

  it("accepts version 1 manifest", () => {
    const deployDir = tmpDeployDir();
    writeFileSync(
      join(deployDir, "ops", "integrations", ".integration-manifest.json"),
      JSON.stringify({ version: 1, integrations: [] }),
    );
    const manifest = loadIntegrationManifest(deployDir);
    expect(manifest.version).toBe(1);
  });
});

describe("provider manifest version validation", () => {
  it("throws on unsupported version", () => {
    const deployDir = tmpDeployDir();
    writeFileSync(
      join(deployDir, "ops", "providers", ".provider-manifest.json"),
      JSON.stringify({ version: 5, providers: [] }),
    );
    expect(() => loadProviderManifest(deployDir)).toThrow(
      /Unsupported provider manifest version 5 \(expected 1\)/,
    );
  });

  it("throws on missing version field", () => {
    const deployDir = tmpDeployDir();
    writeFileSync(
      join(deployDir, "ops", "providers", ".provider-manifest.json"),
      JSON.stringify({ providers: [] }),
    );
    expect(() => loadProviderManifest(deployDir)).toThrow(
      /Unsupported provider manifest version undefined \(expected 1\)/,
    );
  });

  it("accepts version 1 manifest", () => {
    const deployDir = tmpDeployDir();
    writeFileSync(
      join(deployDir, "ops", "providers", ".provider-manifest.json"),
      JSON.stringify({ version: 1, providers: [] }),
    );
    const manifest = loadProviderManifest(deployDir);
    expect(manifest.version).toBe(1);
  });
});

describe("role manifest version validation", () => {
  it("throws on unsupported version", () => {
    const deployDir = tmpDeployDir();
    writeFileSync(
      join(deployDir, "ops", "roles", ".role-manifest.json"),
      JSON.stringify({ version: 3, roles: [], assignments: {} }),
    );
    expect(() => loadRoleManifest(deployDir)).toThrow(
      /Unsupported role manifest version 3 \(expected 1\)/,
    );
  });

  it("throws on missing version field", () => {
    const deployDir = tmpDeployDir();
    writeFileSync(
      join(deployDir, "ops", "roles", ".role-manifest.json"),
      JSON.stringify({ roles: [], assignments: {} }),
    );
    expect(() => loadRoleManifest(deployDir)).toThrow(
      /Unsupported role manifest version undefined \(expected 1\)/,
    );
  });

  it("accepts version 1 manifest", () => {
    const deployDir = tmpDeployDir();
    writeFileSync(
      join(deployDir, "ops", "roles", ".role-manifest.json"),
      JSON.stringify({ version: 1, roles: [], assignments: {} }),
    );
    const manifest = loadRoleManifest(deployDir);
    expect(manifest.version).toBe(1);
  });
});

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { detectLegacyInstallation, migrateDeployDir } from "./migrate.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "clawhq-migrate-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** Create a minimal legacy installation at the given path. */
function createLegacyInstall(dir: string): void {
  mkdirSync(join(dir, "engine"), { recursive: true });
  mkdirSync(join(dir, "workspace", "identity"), { recursive: true });
  mkdirSync(join(dir, "workspace", "tools"), { recursive: true });
  mkdirSync(join(dir, "workspace", "memory"), { recursive: true });
  mkdirSync(join(dir, "cron"), { recursive: true });
  mkdirSync(join(dir, "ops"), { recursive: true });

  writeFileSync(join(dir, "engine", "openclaw.json"), '{"test": true}\n');
  writeFileSync(join(dir, "workspace", "identity", "SOUL.md"), "# Test Agent\n");
  writeFileSync(join(dir, "workspace", "memory", "tasks.json"), "[]\n");
  writeFileSync(join(dir, "cron", "jobs.json"), "[]\n");
}

// ── detectLegacyInstallation ────────────────────────────────────────────────

describe("detectLegacyInstallation", () => {
  it("returns null when directory does not exist", () => {
    const result = detectLegacyInstallation(join(tempDir, "nonexistent"));
    expect(result).toBeNull();
  });

  it("returns null for empty directory", () => {
    const dir = join(tempDir, "empty");
    mkdirSync(dir);
    const result = detectLegacyInstallation(dir);
    expect(result).toBeNull();
  });

  it("detects directory with engine/ subdirectory", () => {
    const dir = join(tempDir, "legacy");
    mkdirSync(join(dir, "engine"), { recursive: true });
    const result = detectLegacyInstallation(dir);
    expect(result).toBe(dir);
  });

  it("detects directory with workspace/ subdirectory", () => {
    const dir = join(tempDir, "legacy");
    mkdirSync(join(dir, "workspace"), { recursive: true });
    const result = detectLegacyInstallation(dir);
    expect(result).toBe(dir);
  });

  it("detects directory with openclaw.json", () => {
    const dir = join(tempDir, "legacy");
    mkdirSync(dir);
    writeFileSync(join(dir, "openclaw.json"), "{}");
    const result = detectLegacyInstallation(dir);
    expect(result).toBe(dir);
  });

  it("detects directory with clawhq.yaml", () => {
    const dir = join(tempDir, "legacy");
    mkdirSync(dir);
    writeFileSync(join(dir, "clawhq.yaml"), "version: '1'");
    const result = detectLegacyInstallation(dir);
    expect(result).toBe(dir);
  });
});

// ── migrateDeployDir ────────────────────────────────────────────────────────

describe("migrateDeployDir", () => {
  it("fails when no legacy installation found", () => {
    const result = migrateDeployDir({
      sourceDir: join(tempDir, "nonexistent"),
      targetDir: join(tempDir, "target"),
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("No legacy installation found");
  });

  it("renames source to target when target does not exist", () => {
    const source = join(tempDir, "openclaw");
    const target = join(tempDir, "clawhq");

    createLegacyInstall(source);
    const result = migrateDeployDir({ sourceDir: source, targetDir: target });

    expect(result.success).toBe(true);
    expect(result.targetExisted).toBe(false);
    expect(existsSync(target)).toBe(true);
    expect(existsSync(join(target, "engine", "openclaw.json"))).toBe(true);
    expect(existsSync(join(target, "workspace", "identity", "SOUL.md"))).toBe(true);
    // Source was renamed, so it should not exist
    expect(existsSync(source)).toBe(false);
    expect(result.sourceRemoved).toBe(true);
  });

  it("merges into existing target when target exists", () => {
    const source = join(tempDir, "openclaw");
    const target = join(tempDir, "clawhq");

    createLegacyInstall(source);

    // Create target with some existing content
    mkdirSync(join(target, "engine"), { recursive: true });
    writeFileSync(join(target, "engine", "docker-compose.yml"), "existing\n");

    const result = migrateDeployDir({ sourceDir: source, targetDir: target });

    expect(result.success).toBe(true);
    expect(result.targetExisted).toBe(true);
    // Existing file should be preserved (not overwritten)
    // New files from source should be present
    expect(existsSync(join(target, "engine", "openclaw.json"))).toBe(true);
    expect(existsSync(join(target, "workspace", "identity", "SOUL.md"))).toBe(true);
  });

  it("removes source when --remove-source is set", () => {
    const source = join(tempDir, "openclaw");
    const target = join(tempDir, "clawhq");

    createLegacyInstall(source);

    // Create target so source won't be renamed away
    mkdirSync(join(target, "engine"), { recursive: true });

    const result = migrateDeployDir({
      sourceDir: source,
      targetDir: target,
      removeSource: true,
    });

    expect(result.success).toBe(true);
    expect(result.sourceRemoved).toBe(true);
    expect(existsSync(source)).toBe(false);
  });

  it("preserves source when --remove-source is not set", () => {
    const source = join(tempDir, "openclaw");
    const target = join(tempDir, "clawhq");

    createLegacyInstall(source);
    mkdirSync(join(target, "engine"), { recursive: true });

    const result = migrateDeployDir({
      sourceDir: source,
      targetDir: target,
      removeSource: false,
    });

    expect(result.success).toBe(true);
    expect(result.sourceRemoved).toBe(false);
    expect(existsSync(source)).toBe(true);
  });

  it("reports progress via callback", () => {
    const source = join(tempDir, "openclaw");
    const target = join(tempDir, "clawhq");

    createLegacyInstall(source);

    const steps: string[] = [];
    migrateDeployDir({
      sourceDir: source,
      targetDir: target,
      onProgress: (step) => {
        steps.push(step);
      },
    });

    expect(steps).toContain("detect");
    expect(steps).toContain("migrate");
    expect(steps).toContain("validate");
    expect(steps).toContain("done");
  });

  it("reports items migrated count", () => {
    const source = join(tempDir, "openclaw");
    const target = join(tempDir, "clawhq");

    createLegacyInstall(source);

    const result = migrateDeployDir({ sourceDir: source, targetDir: target });
    expect(result.success).toBe(true);
    expect(result.itemsMigrated).toBeGreaterThan(0);
  });
});

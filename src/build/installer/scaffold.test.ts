import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { DIR_MODE_SECRET } from "../../config/defaults.js";

import { scaffoldDirs, writeInitialConfig } from "./scaffold.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "clawhq-installer-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ── scaffoldDirs ────────────────────────────────────────────────────────────

describe("scaffoldDirs", () => {
  it("creates the root deploy directory", () => {
    const deployDir = join(tempDir, "test-clawhq");
    scaffoldDirs(deployDir);

    expect(existsSync(deployDir)).toBe(true);
  });

  it("creates all required subdirectories", () => {
    const deployDir = join(tempDir, "test-clawhq");
    const result = scaffoldDirs(deployDir);

    const expected = [
      "engine",
      "workspace",
      "workspace/identity",
      "workspace/tools",
      "workspace/skills",
      "workspace/memory",
      "ops",
      "ops/doctor",
      "ops/monitor",
      "ops/backup/snapshots",
      "ops/updater/rollback",
      "ops/audit",
      "ops/firewall",
      "security",
      "cron",
      "cloud",
    ];

    for (const sub of expected) {
      expect(existsSync(join(deployDir, sub))).toBe(true);
    }

    expect(result.deployDir).toBe(deployDir);
    // Root + 16 subdirectories
    expect(result.created).toHaveLength(17);
  });

  it("creates security/ and cloud/ with DIR_MODE_SECRET (0o700)", () => {
    const deployDir = join(tempDir, "test-clawhq");
    scaffoldDirs(deployDir);

    for (const sub of ["security", "cloud"]) {
      const stat = statSync(join(deployDir, sub));
      expect(stat.mode & 0o777).toBe(DIR_MODE_SECRET);
    }
  });

  it("fixes existing security/ and cloud/ dirs to DIR_MODE_SECRET", () => {
    const deployDir = join(tempDir, "test-clawhq");
    // First scaffold creates dirs (simulates prior install with default perms)
    scaffoldDirs(deployDir);

    // Manually widen permissions to simulate a prior 0755 install
    for (const sub of ["security", "cloud"]) {
      chmodSync(join(deployDir, sub), 0o755);
    }

    // Second scaffold should fix permissions via chmodSync
    scaffoldDirs(deployDir);

    for (const sub of ["security", "cloud"]) {
      const stat = statSync(join(deployDir, sub));
      expect(stat.mode & 0o777).toBe(DIR_MODE_SECRET);
    }
  });

  it("is idempotent — running twice does not fail", () => {
    const deployDir = join(tempDir, "test-clawhq");
    scaffoldDirs(deployDir);
    const result = scaffoldDirs(deployDir);

    expect(result.deployDir).toBe(deployDir);
  });
});

// ── writeInitialConfig ──────────────────────────────────────────────────────

describe("writeInitialConfig", () => {
  it("writes clawhq.yaml at the deploy root", () => {
    const deployDir = join(tempDir, "test-clawhq");
    scaffoldDirs(deployDir);

    const configPath = writeInitialConfig({ deployDir });

    expect(existsSync(configPath)).toBe(true);
    expect(configPath).toBe(join(deployDir, "clawhq.yaml"));
  });

  it("writes valid YAML with sensible defaults", () => {
    const deployDir = join(tempDir, "test-clawhq");
    scaffoldDirs(deployDir);

    writeInitialConfig({ deployDir });

    const content = readFileSync(join(deployDir, "clawhq.yaml"), "utf-8");
    const config = parseYaml(content) as Record<string, unknown>;

    expect(config.version).toBe("1");
    expect(config.installMethod).toBe("cache");
    expect((config.security as Record<string, unknown>).posture).toBe("hardened");
    expect((config.cloud as Record<string, unknown>).enabled).toBe(false);
    expect((config.cloud as Record<string, unknown>).trustMode).toBe("paranoid");
  });

  it("sets paths to the actual deploy directory", () => {
    const deployDir = join(tempDir, "test-clawhq");
    scaffoldDirs(deployDir);

    writeInitialConfig({ deployDir });

    const content = readFileSync(join(deployDir, "clawhq.yaml"), "utf-8");
    const config = parseYaml(content) as Record<string, unknown>;
    const paths = config.paths as Record<string, string>;

    expect(paths.deployDir).toBe(deployDir);
    expect(paths.engineDir).toBe(join(deployDir, "engine"));
    expect(paths.workspaceDir).toBe(join(deployDir, "workspace"));
    expect(paths.opsDir).toBe(join(deployDir, "ops"));
  });

  it("respects from-source install method", () => {
    const deployDir = join(tempDir, "test-clawhq");
    scaffoldDirs(deployDir);

    writeInitialConfig({ deployDir, installMethod: "source" });

    const content = readFileSync(join(deployDir, "clawhq.yaml"), "utf-8");
    const config = parseYaml(content) as Record<string, unknown>;

    expect(config.installMethod).toBe("source");
  });
});

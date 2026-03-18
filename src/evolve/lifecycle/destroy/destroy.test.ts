import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock DockerClient — no real Docker calls in tests
vi.mock("../../../build/docker/client.js", () => {
  class MockDockerClient {
    async composeExec() {
      return { stdout: "", stderr: "" };
    }
    async ps() {
      return [];
    }
    async exec() {
      return { stdout: "", stderr: "" };
    }
  }
  return { DockerClient: MockDockerClient };
});

// Mock firewall — no real iptables calls
vi.mock("../../../secure/firewall/firewall.js", () => ({
  remove: vi.fn().mockResolvedValue({ success: true, message: "Firewall removed" }),
}));

vi.mock("../../../secure/firewall/types.js", () => ({
  CHAIN_NAME: "CLAWHQ_FWD",
}));

import { destroy, dryRun } from "./destroy.js";
import { buildDestructionManifest, verifyManifest } from "./manifest.js";
import type { DestroyStep } from "./types.js";

describe("dryRun", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-destroy-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("lists workspace as destroyable when present", async () => {
    await mkdir(join(tmpDir, "workspace"), { recursive: true });
    await writeFile(join(tmpDir, "workspace", "test.md"), "test", "utf-8");

    const result = await dryRun({ openclawHome: tmpDir, clawhqConfigDir: join(tmpDir, ".clawhq") });

    const workspaceItem = result.items.find((i) => i.category === "workspace");
    expect(workspaceItem).toBeDefined();
    expect(workspaceItem?.autoDestroy).toBe(true);
  });

  it("lists config files when present", async () => {
    await writeFile(join(tmpDir, "openclaw.json"), '{"model": "local"}', "utf-8");

    const result = await dryRun({ openclawHome: tmpDir, clawhqConfigDir: join(tmpDir, ".clawhq") });

    const configItem = result.items.find((i) => i.category === "config" && i.label.includes("OpenClaw"));
    expect(configItem).toBeDefined();
  });

  it("lists secrets when .env exists", async () => {
    await writeFile(join(tmpDir, ".env"), "SECRET=value", "utf-8");

    const result = await dryRun({ openclawHome: tmpDir, clawhqConfigDir: join(tmpDir, ".clawhq") });

    const secretItem = result.items.find((i) => i.category === "secrets");
    expect(secretItem).toBeDefined();
    expect(secretItem?.autoDestroy).toBe(true);
  });

  it("lists external services as manual cleanup", async () => {
    const result = await dryRun({ openclawHome: tmpDir, clawhqConfigDir: join(tmpDir, ".clawhq") });

    const manualItem = result.items.find((i) => !i.autoDestroy);
    expect(manualItem).toBeDefined();
    expect(manualItem?.manualAction).toBeDefined();
  });

  it("detects backup existence", async () => {
    const backupDir = join(tmpDir, ".clawhq", "backups", "backup-test-001");
    await mkdir(backupDir, { recursive: true });

    const result = await dryRun({ openclawHome: tmpDir, clawhqConfigDir: join(tmpDir, ".clawhq") });

    expect(result.hasBackup).toBe(true);
  });

  it("reports no backup when none exists", async () => {
    const result = await dryRun({ openclawHome: tmpDir, clawhqConfigDir: join(tmpDir, ".clawhq") });

    expect(result.hasBackup).toBe(false);
  });

  it("includes image tags when provided", async () => {
    const result = await dryRun({
      openclawHome: tmpDir,
      clawhqConfigDir: join(tmpDir, ".clawhq"),
      imageTag: "openclaw:custom",
      baseTag: "openclaw:local",
    });

    const imageItems = result.items.filter((i) => i.category === "images");
    expect(imageItems).toHaveLength(2);
  });

  it("derives deployment name from home directory", async () => {
    const result = await dryRun({ openclawHome: tmpDir, clawhqConfigDir: join(tmpDir, ".clawhq") });

    // Should be the basename of the tmpDir path
    expect(result.deploymentName).toBeTruthy();
  });
});

describe("destroy", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-destroy-exec-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("wipes workspace directory", async () => {
    await mkdir(join(tmpDir, "workspace", "identity"), { recursive: true });
    await writeFile(join(tmpDir, "workspace", "identity", "SYSTEM.md"), "test", "utf-8");

    await destroy({
      openclawHome: tmpDir,
      clawhqConfigDir: join(tmpDir, ".clawhq"),
      deploymentName: "test-agent",
    });

    // Workspace should be gone
    await expect(stat(join(tmpDir, "workspace"))).rejects.toThrow();
  });

  it("wipes config files", async () => {
    await writeFile(join(tmpDir, "openclaw.json"), '{"model": "local"}', "utf-8");
    await writeFile(join(tmpDir, "docker-compose.yml"), "version: '3'", "utf-8");
    await mkdir(join(tmpDir, "cron"), { recursive: true });
    await writeFile(join(tmpDir, "cron", "jobs.json"), "[]", "utf-8");

    await destroy({
      openclawHome: tmpDir,
      clawhqConfigDir: join(tmpDir, ".clawhq"),
      deploymentName: "test-agent",
    });

    await expect(stat(join(tmpDir, "openclaw.json"))).rejects.toThrow();
    await expect(stat(join(tmpDir, "docker-compose.yml"))).rejects.toThrow();
    await expect(stat(join(tmpDir, "cron"))).rejects.toThrow();
  });

  it("wipes secret files", async () => {
    await writeFile(join(tmpDir, ".env"), "SECRET=value", "utf-8");

    await destroy({
      openclawHome: tmpDir,
      clawhqConfigDir: join(tmpDir, ".clawhq"),
      deploymentName: "test-agent",
    });

    await expect(stat(join(tmpDir, ".env"))).rejects.toThrow();
  });

  it("removes clawhq config directory", async () => {
    const clawhqDir = join(tmpDir, ".clawhq");
    await mkdir(clawhqDir, { recursive: true });
    await writeFile(join(clawhqDir, "config.json"), "{}", "utf-8");

    await destroy({
      openclawHome: tmpDir,
      clawhqConfigDir: clawhqDir,
      deploymentName: "test-agent",
    });

    await expect(stat(clawhqDir)).rejects.toThrow();
  });

  it("preserves export bundles with --keep-export", async () => {
    const clawhqDir = join(tmpDir, ".clawhq");
    await mkdir(clawhqDir, { recursive: true });
    await writeFile(join(clawhqDir, "config.json"), "{}", "utf-8");
    await writeFile(join(clawhqDir, "export-2026-03-13.tar.gz"), "fake export", "utf-8");

    await destroy({
      openclawHome: tmpDir,
      clawhqConfigDir: clawhqDir,
      deploymentName: "test-agent",
      keepExport: true,
    });

    // Export bundle should be preserved
    const exportFile = await stat(join(clawhqDir, "export-2026-03-13.tar.gz"));
    expect(exportFile.isFile()).toBe(true);

    // Non-export file should be removed
    await expect(stat(join(clawhqDir, "config.json"))).rejects.toThrow();
  });

  it("generates signed destruction manifest", async () => {
    const result = await destroy({
      openclawHome: tmpDir,
      clawhqConfigDir: join(tmpDir, ".clawhq"),
      deploymentName: "test-agent",
    });

    expect(result.manifest).toBeDefined();
    expect(result.manifest?.manifestId).toMatch(/^destroy-/);
    expect(result.manifest?.deploymentName).toBe("test-agent");
    expect(result.manifest?.verification.algorithm).toBe("sha256");
    expect(result.manifest?.verification.hash).toHaveLength(64);
  });

  it("returns success when all steps pass", async () => {
    const result = await destroy({
      openclawHome: tmpDir,
      clawhqConfigDir: join(tmpDir, ".clawhq"),
      deploymentName: "test-agent",
    });

    expect(result.success).toBe(true);
    expect(result.steps.length).toBeGreaterThan(0);
    for (const step of result.steps) {
      expect(["done", "skipped"]).toContain(step.status);
    }
  });

  it("tracks step durations", async () => {
    const result = await destroy({
      openclawHome: tmpDir,
      clawhqConfigDir: join(tmpDir, ".clawhq"),
      deploymentName: "test-agent",
    });

    for (const step of result.steps) {
      expect(step.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("buildDestructionManifest", () => {
  it("creates manifest with verification hash", () => {
    const steps: DestroyStep[] = [
      { name: "Stop container", status: "done", message: "Stopped", durationMs: 100 },
      { name: "Wipe workspace", status: "done", message: "Wiped", durationMs: 50 },
    ];

    const manifest = buildDestructionManifest("test-agent", steps);

    expect(manifest.manifestId).toMatch(/^destroy-/);
    expect(manifest.deploymentName).toBe("test-agent");
    expect(manifest.version).toBe(1);
    expect(manifest.steps).toHaveLength(2);
    expect(manifest.verification.algorithm).toBe("sha256");
    expect(manifest.verification.hash).toHaveLength(64);
  });

  it("includes step hashes", () => {
    const steps: DestroyStep[] = [
      { name: "Test step", status: "done", message: "Done", durationMs: 10 },
    ];

    const manifest = buildDestructionManifest("test-agent", steps);

    expect(manifest.steps[0].hash).toHaveLength(64);
  });
});

describe("verifyManifest", () => {
  it("verifies valid manifest", () => {
    const steps: DestroyStep[] = [
      { name: "Stop container", status: "done", message: "Stopped", durationMs: 100 },
    ];

    const manifest = buildDestructionManifest("test-agent", steps);

    expect(verifyManifest(manifest)).toBe(true);
  });

  it("rejects tampered manifest", () => {
    const steps: DestroyStep[] = [
      { name: "Stop container", status: "done", message: "Stopped", durationMs: 100 },
    ];

    const manifest = buildDestructionManifest("test-agent", steps);
    manifest.steps[0].status = "failed"; // Tamper

    expect(verifyManifest(manifest)).toBe(false);
  });
});

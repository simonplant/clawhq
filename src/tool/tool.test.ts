import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadRegistry } from "./registry.js";
import { getRequiredBinaries, installTool, listTools, patchDockerfile, removeToolOp } from "./tool.js";
import type { ToolContext } from "./types.js";
import { ToolError } from "./types.js";

describe("tool lifecycle", () => {
  let tmpDir: string;
  let ctx: ToolContext;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-tool-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    ctx = {
      openclawHome: join(tmpDir, "openclaw"),
      clawhqDir: tmpDir,
    };
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("installTool", () => {
    it("installs a known tool", async () => {
      const result = await installTool(ctx, "himalaya");

      expect(result.tool.name).toBe("himalaya");
      expect(result.tool.explicit).toBe(true);
      expect(result.definition.name).toBe("himalaya");
      expect(result.requiresRebuild).toBe(true);

      // Verify persisted
      const registry = await loadRegistry(ctx);
      expect(registry.tools).toHaveLength(1);
      expect(registry.tools[0].name).toBe("himalaya");
    });

    it("rejects unknown tools", async () => {
      await expect(installTool(ctx, "nonexistent")).rejects.toThrow(ToolError);
      await expect(installTool(ctx, "nonexistent")).rejects.toThrow("Unknown tool");
    });

    it("rejects always-included tools", async () => {
      await expect(installTool(ctx, "curl")).rejects.toThrow(ToolError);
      await expect(installTool(ctx, "curl")).rejects.toThrow("always included");
    });

    it("rejects duplicate installs", async () => {
      await installTool(ctx, "himalaya");
      await expect(installTool(ctx, "himalaya")).rejects.toThrow("already installed");
    });
  });

  describe("removeToolOp", () => {
    it("removes an installed tool", async () => {
      await installTool(ctx, "gh");
      const result = await removeToolOp(ctx, "gh");

      expect(result.tool.name).toBe("gh");
      expect(result.requiresRebuild).toBe(true);

      // Verify removed
      const registry = await loadRegistry(ctx);
      expect(registry.tools).toHaveLength(0);
    });

    it("rejects removing always-included tools", async () => {
      await expect(removeToolOp(ctx, "jq")).rejects.toThrow("always included");
    });

    it("rejects removing non-installed tools", async () => {
      await expect(removeToolOp(ctx, "himalaya")).rejects.toThrow("not installed");
    });
  });

  describe("listTools", () => {
    it("lists all known tools with status", async () => {
      const entries = await listTools(ctx);

      // Should list all known tools
      expect(entries.length).toBeGreaterThan(0);

      // Always-included should show as installed
      const curl = entries.find((e) => e.name === "curl");
      expect(curl).toBeDefined();
      expect(curl?.installed).toBe(true);
      expect(curl?.alwaysIncluded).toBe(true);

      // Non-installed optional tools
      const himalaya = entries.find((e) => e.name === "himalaya");
      expect(himalaya).toBeDefined();
      expect(himalaya?.installed).toBe(false);
      expect(himalaya?.alwaysIncluded).toBe(false);
    });

    it("reflects installed tools", async () => {
      await installTool(ctx, "himalaya");
      const entries = await listTools(ctx);

      const himalaya = entries.find((e) => e.name === "himalaya");
      expect(himalaya?.installed).toBe(true);
      expect(himalaya?.installedAt).toBeTruthy();
    });
  });

  describe("getRequiredBinaries", () => {
    it("includes always-included tools", async () => {
      const binaries = await getRequiredBinaries(ctx);

      expect(binaries.has("curl")).toBe(true);
      expect(binaries.has("jq")).toBe(true);
      expect(binaries.has("rg")).toBe(true);
    });

    it("includes explicitly installed tools", async () => {
      await installTool(ctx, "himalaya");
      await installTool(ctx, "gh");

      const binaries = await getRequiredBinaries(ctx);

      expect(binaries.has("himalaya")).toBe(true);
      expect(binaries.has("gh")).toBe(true);
    });

    it("excludes removed tools", async () => {
      await installTool(ctx, "himalaya");
      await removeToolOp(ctx, "himalaya");

      const binaries = await getRequiredBinaries(ctx);
      expect(binaries.has("himalaya")).toBe(false);
    });
  });

  describe("patchDockerfile", () => {
    it("writes a Dockerfile with always-included tools", async () => {
      const deployDir = join(tmpDir, "deploy");
      const result = await patchDockerfile(ctx, deployDir);

      expect(result.dockerfilePath).toBe(join(deployDir, "Dockerfile"));
      expect(result.binaries).toContain("curl");
      expect(result.binaries).toContain("jq");
      expect(result.binaries).toContain("rg");

      const content = await readFile(result.dockerfilePath, "utf-8");
      expect(content).toContain("FROM openclaw:local");
      expect(content).toContain("curl");
      expect(content).toContain("jq");
      expect(content).toContain("ripgrep");
    });

    it("includes installed tool in Dockerfile after install", async () => {
      await installTool(ctx, "himalaya");
      const deployDir = join(tmpDir, "deploy");
      const result = await patchDockerfile(ctx, deployDir);

      expect(result.binaries).toContain("himalaya");

      const content = await readFile(result.dockerfilePath, "utf-8");
      expect(content).toContain("himalaya");
    });

    it("excludes removed tool from Dockerfile after remove", async () => {
      await installTool(ctx, "himalaya");
      const deployDir = join(tmpDir, "deploy");

      // Patch with himalaya
      let result = await patchDockerfile(ctx, deployDir);
      expect(result.binaries).toContain("himalaya");

      // Remove and re-patch
      await removeToolOp(ctx, "himalaya");
      result = await patchDockerfile(ctx, deployDir);
      expect(result.binaries).not.toContain("himalaya");

      const content = await readFile(result.dockerfilePath, "utf-8");
      expect(content).not.toContain("himalaya email client");
    });

    it("includes yq fragment when yq is installed", async () => {
      await installTool(ctx, "yq");
      const deployDir = join(tmpDir, "deploy");
      const result = await patchDockerfile(ctx, deployDir);

      expect(result.binaries).toContain("yq");

      const content = await readFile(result.dockerfilePath, "utf-8");
      expect(content).toContain("yq");
      expect(content).toContain("mikefarah/yq");
    });

    it("creates deploy directory if it does not exist", async () => {
      const deployDir = join(tmpDir, "nested", "deploy", "dir");
      const result = await patchDockerfile(ctx, deployDir);

      const content = await readFile(result.dockerfilePath, "utf-8");
      expect(content).toContain("FROM openclaw:local");
    });
  });
});

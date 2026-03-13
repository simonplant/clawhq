import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { collectWorkspaceMetrics } from "./workspace.js";

const TEST_DIR = "/tmp/clawhq-workspace-test";
const WORKSPACE_DIR = join(TEST_DIR, "workspace");

beforeEach(async () => {
  await mkdir(join(WORKSPACE_DIR, "memory/hot"), { recursive: true });
  await mkdir(join(WORKSPACE_DIR, "memory/warm"), { recursive: true });
  await mkdir(join(WORKSPACE_DIR, "memory/cold"), { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("collectWorkspaceMetrics", () => {
  it("counts memory files and sizes per tier", async () => {
    await writeFile(join(WORKSPACE_DIR, "memory/hot/recent.md"), "hello world");
    await writeFile(join(WORKSPACE_DIR, "memory/warm/old.md"), "some older memory content here");

    const metrics = await collectWorkspaceMetrics({ openclawHome: TEST_DIR });

    const hot = metrics.memoryTiers.find((t) => t.tier === "hot");
    const warm = metrics.memoryTiers.find((t) => t.tier === "warm");
    const cold = metrics.memoryTiers.find((t) => t.tier === "cold");

    expect(hot).toBeDefined();
    expect(warm).toBeDefined();
    expect(cold).toBeDefined();

    if (hot && warm && cold) {
      expect(hot.fileCount).toBe(1);
      expect(hot.sizeBytes).toBeGreaterThan(0);

      expect(warm.fileCount).toBe(1);
      expect(warm.sizeBytes).toBeGreaterThan(0);

      expect(cold.fileCount).toBe(0);
      expect(cold.sizeBytes).toBe(0);

      expect(metrics.totalMemoryBytes).toBe(hot.sizeBytes + warm.sizeBytes);
    }
  });

  it("reads identity files and estimates tokens", async () => {
    // ~80 chars -> ~20 tokens at 4 bytes/token
    await writeFile(
      join(WORKSPACE_DIR, "IDENTITY.md"),
      "You are a helpful personal assistant named Alex. You manage email and calendar.",
    );

    const metrics = await collectWorkspaceMetrics({ openclawHome: TEST_DIR });

    expect(metrics.identityFiles).toHaveLength(1);
    expect(metrics.identityFiles[0].name).toBe("IDENTITY.md");
    expect(metrics.identityFiles[0].sizeBytes).toBeGreaterThan(0);
    expect(metrics.identityFiles[0].estimatedTokens).toBeGreaterThan(0);
    expect(metrics.totalIdentityTokens).toBe(metrics.identityFiles[0].estimatedTokens);
  });

  it("handles missing workspace directory gracefully", async () => {
    const metrics = await collectWorkspaceMetrics({ openclawHome: "/tmp/nonexistent-ws-test" });

    expect(metrics.memoryTiers).toHaveLength(3);
    for (const tier of metrics.memoryTiers) {
      expect(tier.sizeBytes).toBe(0);
      expect(tier.fileCount).toBe(0);
    }
    expect(metrics.identityFiles).toHaveLength(0);
    expect(metrics.totalMemoryBytes).toBe(0);
    expect(metrics.totalIdentityTokens).toBe(0);
  });
});

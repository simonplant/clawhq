import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  detectStage1Changes,
  formatDuration,
  formatSize,
  generateManifest,
  readManifest,
  readStage1Hash,
  twoStageBuild,
  verifyAgainstManifest,
  writeManifest,
  writeStage1Hash,
} from "./build.js";
import type { DockerClient, ExecResult, ImageInspectResult } from "./client.js";

/** Create a mock DockerClient with spied methods. */
function createMockClient(overrides: Partial<DockerClient> = {}): DockerClient {
  const successResult: ExecResult = { stdout: "ok\n", stderr: "" };
  return {
    exec: vi.fn<() => Promise<ExecResult>>().mockResolvedValue(successResult),
    composeExec: vi.fn<() => Promise<ExecResult>>().mockResolvedValue(successResult),
    build: vi.fn<() => Promise<ExecResult>>().mockResolvedValue(successResult),
    up: vi.fn<() => Promise<ExecResult>>().mockResolvedValue(successResult),
    down: vi.fn<() => Promise<ExecResult>>().mockResolvedValue(successResult),
    restart: vi.fn<() => Promise<ExecResult>>().mockResolvedValue(successResult),
    ps: vi.fn().mockResolvedValue([]),
    logs: vi.fn<() => Promise<ExecResult>>().mockResolvedValue(successResult),
    inspect: vi.fn().mockResolvedValue([]),
    networkLs: vi.fn().mockResolvedValue([]),
    imageExists: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
    imageInspect: vi.fn<() => Promise<ImageInspectResult>>().mockResolvedValue({
      id: "sha256:abc123",
      layers: ["sha256:layer1", "sha256:layer2"],
      size: 524288000,
      created: "2026-03-12T00:00:00Z",
      config: {},
    }),
    pollHealth: vi.fn().mockResolvedValue({ containerId: "", status: "healthy", elapsedMs: 0 }),
    ...overrides,
  } as unknown as DockerClient;
}

describe("twoStageBuild", () => {
  it("builds both stages and returns timing", async () => {
    const client = createMockClient();

    const result = await twoStageBuild(client, {
      context: "/app",
      baseTag: "myapp-base:latest",
      finalTag: "myapp:latest",
    });

    expect(result.stage1).not.toBeNull();
    expect(result.stage1?.stage).toBe(1);
    expect(result.stage1?.imageTag).toBe("myapp-base:latest");
    expect(result.stage1?.success).toBe(true);
    expect(result.stage1?.durationMs).toBeGreaterThanOrEqual(0);

    expect(result.stage2.stage).toBe(2);
    expect(result.stage2.imageTag).toBe("myapp:latest");
    expect(result.stage2.success).toBe(true);
    expect(result.stage2.durationMs).toBeGreaterThanOrEqual(0);

    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(client.build).toHaveBeenCalledTimes(2);
  });

  it("passes dockerfile, stage1Args, and target to stage 1", async () => {
    const client = createMockClient();

    await twoStageBuild(client, {
      context: "/app",
      baseTag: "base:v1",
      finalTag: "final:v1",
      dockerfile: "Dockerfile.prod",
      stage1Args: { NODE_VERSION: "20" },
    });

    expect(client.build).toHaveBeenCalledWith("/app", {
      tag: "base:v1",
      file: "Dockerfile.prod",
      target: "base",
      buildArgs: { NODE_VERSION: "20" },
      signal: undefined,
    });
  });

  it("passes stage2Args and BASE_IMAGE to stage 2", async () => {
    const client = createMockClient();

    await twoStageBuild(client, {
      context: "/app",
      baseTag: "base:v1",
      finalTag: "final:v1",
      stage2Args: { TOOLS: "jq,curl" },
    });

    expect(client.build).toHaveBeenCalledWith("/app", {
      tag: "final:v1",
      file: undefined,
      target: "custom",
      buildArgs: { TOOLS: "jq,curl", BASE_IMAGE: "base:v1" },
      signal: undefined,
    });
  });

  it("skips stage 1 when image exists and skipStage1IfExists is true", async () => {
    const client = createMockClient({
      imageExists: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    });

    const result = await twoStageBuild(client, {
      context: "/app",
      baseTag: "base:v1",
      finalTag: "final:v1",
      skipStage1IfExists: true,
    });

    expect(result.stage1).toBeNull();
    expect(client.build).toHaveBeenCalledTimes(1);
    expect(client.imageExists).toHaveBeenCalledWith("base:v1", { signal: undefined });
  });

  it("skips stage 1 when skipStage1 is true", async () => {
    const client = createMockClient();

    const result = await twoStageBuild(client, {
      context: "/app",
      baseTag: "base:v1",
      finalTag: "final:v1",
      skipStage1: true,
    });

    expect(result.stage1).toBeNull();
    expect(client.build).toHaveBeenCalledTimes(1);
  });

  it("builds stage 1 when image does not exist even with skipStage1IfExists", async () => {
    const client = createMockClient({
      imageExists: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
    });

    const result = await twoStageBuild(client, {
      context: "/app",
      baseTag: "base:v1",
      finalTag: "final:v1",
      skipStage1IfExists: true,
    });

    expect(result.stage1).not.toBeNull();
    expect(client.build).toHaveBeenCalledTimes(2);
  });

  it("passes AbortSignal to both stages", async () => {
    const client = createMockClient();
    const controller = new AbortController();

    await twoStageBuild(client, {
      context: "/app",
      baseTag: "base:v1",
      finalTag: "final:v1",
      signal: controller.signal,
    });

    expect(client.build).toHaveBeenCalledWith("/app", expect.objectContaining({
      signal: controller.signal,
    }));
    const calls = vi.mocked(client.build).mock.calls;
    expect(calls[0][1]?.signal).toBe(controller.signal);
    expect(calls[1][1]?.signal).toBe(controller.signal);
  });
});

describe("generateManifest", () => {
  it("generates manifest with both stages", async () => {
    const baseInspect: ImageInspectResult = {
      id: "sha256:base111",
      layers: ["sha256:l1"],
      size: 100000,
      created: "2026-03-12T00:00:00Z",
      config: {},
    };
    const finalInspect: ImageInspectResult = {
      id: "sha256:final222",
      layers: ["sha256:l1", "sha256:l2"],
      size: 200000,
      created: "2026-03-12T01:00:00Z",
      config: {},
    };

    const client = createMockClient({
      imageExists: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
      imageInspect: vi.fn()
        .mockResolvedValueOnce(baseInspect)
        .mockResolvedValueOnce(finalInspect),
    });

    const manifest = await generateManifest(client, {
      context: "/app",
      baseTag: "base:v1",
      finalTag: "final:v1",
      stage1Args: { NODE_VERSION: "20" },
      stage2Args: { TOOLS: "jq" },
      stage1Built: true,
    });

    expect(manifest.version).toBe(1);
    expect(manifest.context).toBe("/app");
    expect(manifest.stage1).not.toBeNull();
    expect(manifest.stage1?.imageId).toBe("sha256:base111");
    expect(manifest.stage1?.buildArgs).toEqual({ NODE_VERSION: "20" });
    expect(manifest.stage2.imageId).toBe("sha256:final222");
    expect(manifest.stage2.buildArgs).toEqual({ TOOLS: "jq" });
  });

  it("generates manifest without stage 1 when not built and not existing", async () => {
    const client = createMockClient({
      imageExists: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
    });

    const manifest = await generateManifest(client, {
      context: "/app",
      baseTag: "base:v1",
      finalTag: "final:v1",
      stage1Built: false,
    });

    expect(manifest.stage1).toBeNull();
    expect(manifest.stage2).toBeDefined();
  });
});

describe("writeManifest / readManifest", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "clawhq-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes and reads manifest as JSON", async () => {
    const manifest = {
      version: 1 as const,
      generatedAt: "2026-03-12T00:00:00Z",
      context: "/app",
      dockerfile: "Dockerfile",
      stage1: {
        imageTag: "base:v1",
        imageId: "sha256:abc",
        layers: ["sha256:l1"],
        size: 100000,
        created: "2026-03-12T00:00:00Z",
        buildArgs: {},
      },
      stage2: {
        imageTag: "final:v1",
        imageId: "sha256:def",
        layers: ["sha256:l1", "sha256:l2"],
        size: 200000,
        created: "2026-03-12T01:00:00Z",
        buildArgs: {},
      },
    };

    const path = await writeManifest(manifest, tmpDir);
    expect(path).toContain("build-manifest.json");

    const loaded = await readManifest(tmpDir);
    expect(loaded).toEqual(manifest);
  });

  it("returns null when manifest does not exist", async () => {
    const result = await readManifest(tmpDir);
    expect(result).toBeNull();
  });
});

describe("verifyAgainstManifest", () => {
  it("returns match when images match manifest", async () => {
    const client = createMockClient({
      imageExists: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
      imageInspect: vi.fn<() => Promise<ImageInspectResult>>().mockResolvedValue({
        id: "sha256:abc",
        layers: ["sha256:l1", "sha256:l2"],
        size: 200000,
        created: "2026-03-12T00:00:00Z",
        config: {},
      }),
    });

    const manifest = {
      version: 1 as const,
      generatedAt: "2026-03-12T00:00:00Z",
      context: "/app",
      dockerfile: "Dockerfile",
      stage1: null,
      stage2: {
        imageTag: "final:v1",
        imageId: "sha256:abc",
        layers: ["sha256:l1", "sha256:l2"],
        size: 200000,
        created: "2026-03-12T00:00:00Z",
        buildArgs: {},
      },
    };

    const result = await verifyAgainstManifest(client, manifest);
    expect(result.match).toBe(true);
    expect(result.drifts).toHaveLength(0);
  });

  it("detects image ID drift", async () => {
    const client = createMockClient({
      imageExists: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
      imageInspect: vi.fn<() => Promise<ImageInspectResult>>().mockResolvedValue({
        id: "sha256:different",
        layers: ["sha256:l1", "sha256:l2"],
        size: 200000,
        created: "2026-03-12T00:00:00Z",
        config: {},
      }),
    });

    const manifest = {
      version: 1 as const,
      generatedAt: "2026-03-12T00:00:00Z",
      context: "/app",
      dockerfile: "Dockerfile",
      stage1: null,
      stage2: {
        imageTag: "final:v1",
        imageId: "sha256:abc",
        layers: ["sha256:l1", "sha256:l2"],
        size: 200000,
        created: "2026-03-12T00:00:00Z",
        buildArgs: {},
      },
    };

    const result = await verifyAgainstManifest(client, manifest);
    expect(result.match).toBe(false);
    expect(result.drifts).toContainEqual(
      expect.objectContaining({ stage: 2, field: "imageId" }),
    );
  });

  it("detects missing image", async () => {
    const client = createMockClient({
      imageExists: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
    });

    const manifest = {
      version: 1 as const,
      generatedAt: "2026-03-12T00:00:00Z",
      context: "/app",
      dockerfile: "Dockerfile",
      stage1: null,
      stage2: {
        imageTag: "final:v1",
        imageId: "sha256:abc",
        layers: ["sha256:l1"],
        size: 100000,
        created: "2026-03-12T00:00:00Z",
        buildArgs: {},
      },
    };

    const result = await verifyAgainstManifest(client, manifest);
    expect(result.match).toBe(false);
    expect(result.drifts[0].field).toBe("image");
    expect(result.drifts[0].actual).toBe("(missing)");
  });

  it("detects layer count drift", async () => {
    const client = createMockClient({
      imageExists: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
      imageInspect: vi.fn<() => Promise<ImageInspectResult>>().mockResolvedValue({
        id: "sha256:abc",
        layers: ["sha256:l1", "sha256:l2", "sha256:l3"],
        size: 200000,
        created: "2026-03-12T00:00:00Z",
        config: {},
      }),
    });

    const manifest = {
      version: 1 as const,
      generatedAt: "2026-03-12T00:00:00Z",
      context: "/app",
      dockerfile: "Dockerfile",
      stage1: null,
      stage2: {
        imageTag: "final:v1",
        imageId: "sha256:abc",
        layers: ["sha256:l1", "sha256:l2"],
        size: 200000,
        created: "2026-03-12T00:00:00Z",
        buildArgs: {},
      },
    };

    const result = await verifyAgainstManifest(client, manifest);
    expect(result.match).toBe(false);
    expect(result.drifts).toContainEqual(
      expect.objectContaining({ stage: 2, field: "layerCount" }),
    );
  });

  it("verifies both stages when stage 1 exists in manifest", async () => {
    const client = createMockClient({
      imageExists: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
      imageInspect: vi.fn()
        .mockResolvedValueOnce({
          id: "sha256:base",
          layers: ["sha256:l1"],
          size: 100000,
          created: "2026-03-12T00:00:00Z",
          config: {},
        })
        .mockResolvedValueOnce({
          id: "sha256:final",
          layers: ["sha256:l1", "sha256:l2"],
          size: 200000,
          created: "2026-03-12T01:00:00Z",
          config: {},
        }),
    });

    const manifest = {
      version: 1 as const,
      generatedAt: "2026-03-12T00:00:00Z",
      context: "/app",
      dockerfile: "Dockerfile",
      stage1: {
        imageTag: "base:v1",
        imageId: "sha256:base",
        layers: ["sha256:l1"],
        size: 100000,
        created: "2026-03-12T00:00:00Z",
        buildArgs: {},
      },
      stage2: {
        imageTag: "final:v1",
        imageId: "sha256:final",
        layers: ["sha256:l1", "sha256:l2"],
        size: 200000,
        created: "2026-03-12T01:00:00Z",
        buildArgs: {},
      },
    };

    const result = await verifyAgainstManifest(client, manifest);
    expect(result.match).toBe(true);
    expect(client.imageInspect).toHaveBeenCalledTimes(2);
  });
});

describe("detectStage1Changes", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "clawhq-test-"));
    await writeFile(join(tmpDir, "Dockerfile"), "FROM node:20\nRUN apt-get update\n");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns changed=true when no previous hash", async () => {
    const result = await detectStage1Changes(tmpDir, {});
    expect(result.changed).toBe(true);
    expect(result.inputHash).toBeTruthy();
  });

  it("returns changed=false when hash matches", async () => {
    const first = await detectStage1Changes(tmpDir, {});
    const second = await detectStage1Changes(tmpDir, {
      lastInputHash: first.inputHash,
    });
    expect(second.changed).toBe(false);
  });

  it("returns changed=true when Dockerfile changes", async () => {
    const first = await detectStage1Changes(tmpDir, {});
    await writeFile(join(tmpDir, "Dockerfile"), "FROM node:22\nRUN apt-get update\n");
    const second = await detectStage1Changes(tmpDir, {
      lastInputHash: first.inputHash,
    });
    expect(second.changed).toBe(true);
    expect(second.inputHash).not.toBe(first.inputHash);
  });

  it("returns changed=true when build args change", async () => {
    const first = await detectStage1Changes(tmpDir, {
      stage1Args: { PACKAGES: "jq" },
    });
    const second = await detectStage1Changes(tmpDir, {
      stage1Args: { PACKAGES: "jq,curl" },
      lastInputHash: first.inputHash,
    });
    expect(second.changed).toBe(true);
  });

  it("returns changed=true when Dockerfile does not exist", async () => {
    const result = await detectStage1Changes(tmpDir, {
      dockerfile: "nonexistent.Dockerfile",
    });
    expect(result.changed).toBe(true);
    expect(result.inputHash).toBe("");
  });

  it("uses custom Dockerfile path", async () => {
    await writeFile(join(tmpDir, "Dockerfile.prod"), "FROM node:20-slim\n");
    const result = await detectStage1Changes(tmpDir, {
      dockerfile: "Dockerfile.prod",
    });
    expect(result.changed).toBe(true);
    expect(result.inputHash).toBeTruthy();
  });
});

describe("readStage1Hash / writeStage1Hash", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "clawhq-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no hash file exists", async () => {
    const result = await readStage1Hash(tmpDir);
    expect(result).toBeNull();
  });

  it("writes and reads hash", async () => {
    await writeStage1Hash(tmpDir, "abc123def");
    const result = await readStage1Hash(tmpDir);
    expect(result).toBe("abc123def");
  });
});

describe("formatDuration", () => {
  it("formats milliseconds", () => {
    expect(formatDuration(500)).toBe("500ms");
  });

  it("formats seconds", () => {
    expect(formatDuration(5000)).toBe("5s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(125000)).toBe("2m 5s");
  });
});

describe("formatSize", () => {
  it("formats bytes", () => {
    expect(formatSize(500)).toBe("500B");
  });

  it("formats kilobytes", () => {
    expect(formatSize(2048)).toBe("2.0KB");
  });

  it("formats megabytes", () => {
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0MB");
  });

  it("formats gigabytes", () => {
    expect(formatSize(2 * 1024 * 1024 * 1024)).toBe("2.0GB");
  });
});

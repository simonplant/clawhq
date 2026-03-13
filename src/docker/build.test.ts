import { describe, expect, it, vi } from "vitest";

import { twoStageBuild } from "./build.js";
import type { DockerClient, ExecResult } from "./client.js";

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
    imageInspect: vi.fn().mockResolvedValue({ id: "", layers: [], size: 0, created: "", config: {} }),
    pollHealth: vi.fn().mockResolvedValue({ containerId: "", status: "healthy", elapsedMs: 0 }),
    ...overrides,
  } as unknown as DockerClient;
}

describe("twoStageBuild", () => {
  it("builds both stages", async () => {
    const client = createMockClient();

    const result = await twoStageBuild(client, {
      context: "/app",
      baseTag: "myapp-base:latest",
      finalTag: "myapp:latest",
    });

    const { stage1 } = result;
    expect(stage1).not.toBeNull();
    expect(stage1?.stage).toBe(1);
    expect(stage1?.imageTag).toBe("myapp-base:latest");
    expect(stage1?.success).toBe(true);

    expect(result.stage2.stage).toBe(2);
    expect(result.stage2.imageTag).toBe("myapp:latest");
    expect(result.stage2.success).toBe(true);

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
    // Both calls should have the signal
    const calls = vi.mocked(client.build).mock.calls;
    expect(calls[0][1]?.signal).toBe(controller.signal);
    expect(calls[1][1]?.signal).toBe(controller.signal);
  });
});

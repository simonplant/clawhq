import { describe, expect, it, vi } from "vitest";

import type { DockerClient, ExecResult } from "./client.js";
import { pullImages, validateCompose } from "./compose.js";

function createMockClient(): DockerClient {
  const successResult: ExecResult = { stdout: "ok\n", stderr: "" };
  return {
    composeExec: vi.fn<() => Promise<ExecResult>>().mockResolvedValue(successResult),
  } as unknown as DockerClient;
}

describe("validateCompose", () => {
  it("calls docker compose config", async () => {
    const client = createMockClient();

    const result = await validateCompose(client);

    expect(client.composeExec).toHaveBeenCalledWith(["config"], { signal: undefined });
    expect(result.stdout).toBe("ok\n");
  });

  it("passes AbortSignal", async () => {
    const client = createMockClient();
    const controller = new AbortController();

    await validateCompose(client, { signal: controller.signal });

    expect(client.composeExec).toHaveBeenCalledWith(["config"], { signal: controller.signal });
  });
});

describe("pullImages", () => {
  it("calls docker compose pull", async () => {
    const client = createMockClient();

    const result = await pullImages(client);

    expect(client.composeExec).toHaveBeenCalledWith(["pull"], { signal: undefined });
    expect(result.stdout).toBe("ok\n");
  });

  it("passes AbortSignal", async () => {
    const client = createMockClient();
    const controller = new AbortController();

    await pullImages(client, { signal: controller.signal });

    expect(client.composeExec).toHaveBeenCalledWith(["pull"], { signal: controller.signal });
  });
});

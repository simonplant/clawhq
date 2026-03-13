import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DockerClient, DaemonNotRunning } from "../../docker/client.js";
import type { DoctorContext } from "../types.js";

import { dockerDaemonCheck } from "./docker-daemon.js";

// Mock the DockerClient module — vi.mock is hoisted by vitest
vi.mock("../../docker/client.js", () => {
  class MockDaemonNotRunning extends Error {
    name = "DaemonNotRunning";
    stderr: string;
    exitCode: number | null;
    constructor(stderr: string) {
      super("Docker daemon is not running");
      this.stderr = stderr;
      this.exitCode = 1;
    }
  }

  class MockDockerClient {
    static execImpl: (() => Promise<{ stdout: string; stderr: string }>) | undefined;
    async exec(_args: string[]) {
      if (MockDockerClient.execImpl) return MockDockerClient.execImpl();
      return { stdout: "", stderr: "" };
    }
  }

  return {
    DockerClient: MockDockerClient,
    DaemonNotRunning: MockDaemonNotRunning,
  };
});

const MockDockerClient = DockerClient as unknown as {
  execImpl: (() => Promise<{ stdout: string; stderr: string }>) | undefined;
};

function makeCtx(): DoctorContext {
  return {
    openclawHome: "/tmp/openclaw",
    configPath: "/tmp/openclaw/openclaw.json",
  };
}

describe("dockerDaemonCheck", () => {
  beforeEach(() => {
    MockDockerClient.execImpl = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes when docker daemon is running", async () => {
    MockDockerClient.execImpl = async () => ({ stdout: "Docker info", stderr: "" });

    const result = await dockerDaemonCheck.run(makeCtx());

    expect(result.status).toBe("pass");
    expect(result.message).toContain("running");
  });

  it("fails when docker daemon is not running", async () => {
    MockDockerClient.execImpl = async () => {
      throw new DaemonNotRunning("not running");
    };

    const result = await dockerDaemonCheck.run(makeCtx());

    expect(result.status).toBe("fail");
    expect(result.message).toContain("not running");
    expect(result.fix).toContain("systemctl");
  });

  it("fails with generic docker error", async () => {
    MockDockerClient.execImpl = async () => {
      throw new Error("permission denied");
    };

    const result = await dockerDaemonCheck.run(makeCtx());

    expect(result.status).toBe("fail");
    expect(result.message).toContain("permission denied");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { securityPostureCheck } from "./security-posture.js";
import type { SecurityPostureContext } from "./security-posture.js";

// Mock DockerClient
vi.mock("../../docker/client.js", () => {
  class MockDockerClient {
    static psImpl: (() => Promise<Array<{
      id: string; name: string; state: string; status: string; image: string; ports: string;
    }>>) | undefined;

    static inspectImpl: (() => Promise<Record<string, unknown>[]>) | undefined;

    async ps() {
      if (MockDockerClient.psImpl) return MockDockerClient.psImpl();
      return [];
    }

    async inspect(_target: string) {
      if (MockDockerClient.inspectImpl) return MockDockerClient.inspectImpl();
      return [];
    }
  }

  return { DockerClient: MockDockerClient };
});

// Access mock statics
const { DockerClient } = await import("../../docker/client.js");
const MockDockerClient = DockerClient as unknown as {
  psImpl: (() => Promise<Array<{
    id: string; name: string; state: string; status: string; image: string; ports: string;
  }>>) | undefined;
  inspectImpl: (() => Promise<Record<string, unknown>[]>) | undefined;
};

function makeCtx(posture?: string): SecurityPostureContext {
  return {
    openclawHome: "/tmp/openclaw",
    configPath: "/tmp/openclaw/openclaw.json",
    imageTag: "openclaw:custom",
    expectedPosture: posture as SecurityPostureContext["expectedPosture"],
  };
}

const runningContainer = {
  id: "abc123",
  name: "openclaw-agent",
  state: "running",
  status: "Up 2 hours",
  image: "openclaw:custom",
  ports: "18789/tcp",
};

function hardenedInspect(): Record<string, unknown>[] {
  return [{
    HostConfig: {
      CapDrop: ["ALL"],
      ReadonlyRootfs: true,
      SecurityOpt: ["no-new-privileges:true"],
      NanoCpus: 2e9,
      Memory: 2 * 1024 * 1024 * 1024,
      Tmpfs: { "/tmp": "noexec,nosuid,size=128m" },
    },
    Config: {
      User: "1000:1000",
    },
  }];
}

describe("securityPostureCheck", () => {
  beforeEach(() => {
    MockDockerClient.psImpl = undefined;
    MockDockerClient.inspectImpl = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes when container matches hardened posture", async () => {
    MockDockerClient.psImpl = async () => [runningContainer];
    MockDockerClient.inspectImpl = async () => hardenedInspect();

    const result = await securityPostureCheck.run(makeCtx("hardened"));

    expect(result.status).toBe("pass");
    expect(result.message).toContain("hardened");
  });

  it("warns when no container is running", async () => {
    MockDockerClient.psImpl = async () => [];

    const result = await securityPostureCheck.run(makeCtx("hardened"));

    expect(result.status).toBe("warn");
    expect(result.message).toContain("No running container");
  });

  it("warns when no container matches the image tag", async () => {
    MockDockerClient.psImpl = async () => [{
      ...runningContainer,
      image: "other:latest",
    }];

    const result = await securityPostureCheck.run(makeCtx("hardened"));

    expect(result.status).toBe("warn");
  });

  it("fails when cap_drop is missing", async () => {
    MockDockerClient.psImpl = async () => [runningContainer];
    MockDockerClient.inspectImpl = async () => [{
      HostConfig: {
        CapDrop: [],
        ReadonlyRootfs: true,
        SecurityOpt: ["no-new-privileges:true"],
        NanoCpus: 2e9,
        Memory: 2 * 1024 * 1024 * 1024,
      },
      Config: { User: "1000:1000" },
    }];

    const result = await securityPostureCheck.run(makeCtx("hardened"));

    expect(result.status).toBe("fail");
    expect(result.message).toContain("cap_drop");
  });

  it("fails when read_only is false but expected true", async () => {
    MockDockerClient.psImpl = async () => [runningContainer];
    MockDockerClient.inspectImpl = async () => [{
      HostConfig: {
        CapDrop: ["ALL"],
        ReadonlyRootfs: false,
        SecurityOpt: ["no-new-privileges:true"],
        NanoCpus: 2e9,
        Memory: 2 * 1024 * 1024 * 1024,
      },
      Config: { User: "1000:1000" },
    }];

    const result = await securityPostureCheck.run(makeCtx("hardened"));

    expect(result.status).toBe("fail");
    expect(result.message).toContain("read_only");
  });

  it("fails when user is root instead of 1000:1000", async () => {
    MockDockerClient.psImpl = async () => [runningContainer];
    MockDockerClient.inspectImpl = async () => [{
      HostConfig: {
        CapDrop: ["ALL"],
        ReadonlyRootfs: true,
        SecurityOpt: ["no-new-privileges:true"],
        NanoCpus: 2e9,
        Memory: 2 * 1024 * 1024 * 1024,
      },
      Config: { User: "" },
    }];

    const result = await securityPostureCheck.run(makeCtx("hardened"));

    expect(result.status).toBe("fail");
    expect(result.message).toContain("user");
  });

  it("fails when resource limits are wrong", async () => {
    MockDockerClient.psImpl = async () => [runningContainer];
    MockDockerClient.inspectImpl = async () => [{
      HostConfig: {
        CapDrop: ["ALL"],
        ReadonlyRootfs: true,
        SecurityOpt: ["no-new-privileges:true"],
        NanoCpus: 4e9, // 4 CPU instead of 2
        Memory: 4 * 1024 * 1024 * 1024, // 4g instead of 2g
      },
      Config: { User: "1000:1000" },
    }];

    const result = await securityPostureCheck.run(makeCtx("hardened"));

    expect(result.status).toBe("fail");
    expect(result.message).toContain("cpu_limit");
  });

  it("passes for minimal posture with basic settings", async () => {
    MockDockerClient.psImpl = async () => [runningContainer];
    MockDockerClient.inspectImpl = async () => [{
      HostConfig: {
        SecurityOpt: ["no-new-privileges:true"],
        NanoCpus: 4e9,
        Memory: 4 * 1024 * 1024 * 1024,
      },
      Config: { User: "1000:1000" },
    }];

    const result = await securityPostureCheck.run(makeCtx("minimal"));

    expect(result.status).toBe("pass");
    expect(result.message).toContain("minimal");
  });

  it("defaults to hardened posture when not specified", async () => {
    MockDockerClient.psImpl = async () => [runningContainer];
    MockDockerClient.inspectImpl = async () => hardenedInspect();

    const result = await securityPostureCheck.run(makeCtx());

    expect(result.status).toBe("pass");
    expect(result.message).toContain("hardened");
  });

  it("fails gracefully on Docker error", async () => {
    MockDockerClient.psImpl = async () => {
      throw new Error("Docker not available");
    };

    const result = await securityPostureCheck.run(makeCtx("hardened"));

    expect(result.status).toBe("fail");
    expect(result.message).toContain("Docker not available");
  });

  it("reports multiple mismatches", async () => {
    MockDockerClient.psImpl = async () => [runningContainer];
    MockDockerClient.inspectImpl = async () => [{
      HostConfig: {
        CapDrop: [],
        ReadonlyRootfs: false,
        SecurityOpt: [],
        NanoCpus: 0,
        Memory: 0,
      },
      Config: { User: "" },
    }];

    const result = await securityPostureCheck.run(makeCtx("hardened"));

    expect(result.status).toBe("fail");
    // Should report multiple controls
    expect(result.message).toContain("cap_drop");
    expect(result.message).toContain("read_only");
  });

  it("handles no-new-privileges with equals sign format", async () => {
    MockDockerClient.psImpl = async () => [runningContainer];
    MockDockerClient.inspectImpl = async () => [{
      HostConfig: {
        CapDrop: ["ALL"],
        ReadonlyRootfs: true,
        SecurityOpt: ["no-new-privileges=true"], // equals instead of colon
        NanoCpus: 2e9,
        Memory: 2 * 1024 * 1024 * 1024,
      },
      Config: { User: "1000:1000" },
    }];

    const result = await securityPostureCheck.run(makeCtx("hardened"));

    expect(result.status).toBe("pass");
  });
});

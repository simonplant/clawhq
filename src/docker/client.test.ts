import { execFile as execFileCb } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DaemonNotRunning,
  DockerClient,
  DockerError,
  HealthPollTimeout,
  ImageNotFound,
  PortConflict,
} from "./client.js";

// Mock child_process
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

const mockExecFile = vi.mocked(execFileCb);

/** Helper: make execFile resolve with given stdout/stderr. */
function mockSuccess(stdout: string, stderr = "") {
  mockExecFile.mockImplementation((_cmd, _args, _opts, _cb?) => {
    // promisify(execFile) calls execFile(cmd, args, opts) and the underlying
    // callback-based function receives a callback as the last arg.
    // With vi.mock + promisify, the mock is called with (cmd, args, opts)
    // and should return a resolved promise-like or use callback.
    // Since we mocked the callback-based version, we simulate via callback:
    const cb = typeof _opts === "function" ? _opts : _cb;
    if (typeof cb === "function") {
      (cb as (err: null, result: { stdout: string; stderr: string }) => void)(null, {
        stdout,
        stderr,
      });
    }
    return undefined as never;
  });
}

/** Helper: make execFile reject with error. */
function mockFailure(stderr: string, code = 1) {
  mockExecFile.mockImplementation((_cmd, _args, _opts, _cb?) => {
    const cb = typeof _opts === "function" ? _opts : _cb;
    if (typeof cb === "function") {
      const err = Object.assign(new Error("Command failed"), { stderr, code });
      (cb as (err: Error) => void)(err);
    }
    return undefined as never;
  });
}

describe("DockerClient", () => {
  let client: DockerClient;

  beforeEach(() => {
    client = new DockerClient();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("exec", () => {
    it("executes docker commands and returns stdout/stderr", async () => {
      mockSuccess("Docker version 24.0.0\n");

      const result = await client.exec(["version"]);

      expect(result.stdout).toBe("Docker version 24.0.0\n");
      expect(mockExecFile).toHaveBeenCalledWith(
        "docker",
        ["version"],
        expect.objectContaining({ maxBuffer: 10 * 1024 * 1024 }),
        expect.any(Function),
      );
    });

    it("uses custom docker binary path", async () => {
      const customClient = new DockerClient({ dockerBin: "/usr/local/bin/docker" });
      mockSuccess("");

      await customClient.exec(["info"]);

      expect(mockExecFile).toHaveBeenCalledWith(
        "/usr/local/bin/docker",
        ["info"],
        expect.any(Object),
        expect.any(Function),
      );
    });

    it("passes cwd option", async () => {
      const cwdClient = new DockerClient({ cwd: "/project" });
      mockSuccess("");

      await cwdClient.exec(["ps"]);

      expect(mockExecFile).toHaveBeenCalledWith(
        "docker",
        ["ps"],
        expect.objectContaining({ cwd: "/project" }),
        expect.any(Function),
      );
    });
  });

  describe("error classification", () => {
    it("throws DaemonNotRunning when daemon is not available", async () => {
      mockFailure("Cannot connect to the Docker daemon at unix:///var/run/docker.sock");

      await expect(client.exec(["ps"])).rejects.toThrow(DaemonNotRunning);
    });

    it("throws DaemonNotRunning on connection refused", async () => {
      mockFailure("Error response from daemon: connection refused");

      await expect(client.exec(["ps"])).rejects.toThrow(DaemonNotRunning);
    });

    it("throws ImageNotFound when image does not exist", async () => {
      mockFailure("Error: No such image: myapp:latest");

      await expect(client.exec(["image", "inspect", "myapp:latest"])).rejects.toThrow(
        ImageNotFound,
      );
    });

    it("throws PortConflict when port is in use", async () => {
      mockFailure("Error: port is already allocated 0.0.0.0:8080");

      await expect(client.composeExec(["up", "-d"])).rejects.toThrow(PortConflict);
    });

    it("throws generic DockerError for unknown failures", async () => {
      mockFailure("Something unexpected happened");

      await expect(client.exec(["unknown"])).rejects.toThrow(DockerError);
      await expect(client.exec(["unknown"])).rejects.not.toThrow(DaemonNotRunning);
    });

    it("includes stderr and exitCode in error", async () => {
      mockFailure("Some error output", 127);

      try {
        await client.exec(["bad"]);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(DockerError);
        const dockerErr = err as DockerError;
        expect(dockerErr.stderr).toBe("Some error output");
        expect(dockerErr.exitCode).toBe(127);
      }
    });
  });

  describe("composeExec", () => {
    it("prepends 'compose' to args", async () => {
      mockSuccess("");

      await client.composeExec(["up", "-d"]);

      expect(mockExecFile).toHaveBeenCalledWith(
        "docker",
        ["compose", "up", "-d"],
        expect.any(Object),
        expect.any(Function),
      );
    });
  });

  describe("build", () => {
    it("builds with tag, file, target, and build args", async () => {
      mockSuccess("Successfully built abc123\n");

      await client.build(".", {
        tag: "myapp:latest",
        file: "Dockerfile.prod",
        target: "base",
        buildArgs: { NODE_VERSION: "20" },
      });

      expect(mockExecFile).toHaveBeenCalledWith(
        "docker",
        [
          "build",
          "-t", "myapp:latest",
          "-f", "Dockerfile.prod",
          "--target", "base",
          "--build-arg", "NODE_VERSION=20",
          ".",
        ],
        expect.any(Object),
        expect.any(Function),
      );
    });

    it("builds with minimal options", async () => {
      mockSuccess("");

      await client.build("/path/to/context");

      expect(mockExecFile).toHaveBeenCalledWith(
        "docker",
        ["build", "/path/to/context"],
        expect.any(Object),
        expect.any(Function),
      );
    });
  });

  describe("up", () => {
    it("runs compose up -d by default", async () => {
      mockSuccess("");

      await client.up();

      expect(mockExecFile).toHaveBeenCalledWith(
        "docker",
        ["compose", "up", "-d"],
        expect.any(Object),
        expect.any(Function),
      );
    });

    it("runs compose up without -d when detach is false", async () => {
      mockSuccess("");

      await client.up({ detach: false });

      expect(mockExecFile).toHaveBeenCalledWith(
        "docker",
        ["compose", "up"],
        expect.any(Object),
        expect.any(Function),
      );
    });
  });

  describe("down", () => {
    it("runs compose down", async () => {
      mockSuccess("");

      await client.down();

      expect(mockExecFile).toHaveBeenCalledWith(
        "docker",
        ["compose", "down"],
        expect.any(Object),
        expect.any(Function),
      );
    });
  });

  describe("restart", () => {
    it("runs compose restart", async () => {
      mockSuccess("");

      await client.restart();

      expect(mockExecFile).toHaveBeenCalledWith(
        "docker",
        ["compose", "restart"],
        expect.any(Object),
        expect.any(Function),
      );
    });
  });

  describe("ps", () => {
    it("parses JSON container list", async () => {
      mockSuccess(
        '{"ID":"abc","Name":"web","State":"running","Status":"Up 2 hours","Image":"nginx","Ports":"80/tcp"}\n' +
          '{"ID":"def","Name":"db","State":"running","Status":"Up 2 hours","Image":"postgres","Ports":"5432/tcp"}\n',
      );

      const containers = await client.ps();

      expect(containers).toHaveLength(2);
      expect(containers[0]).toEqual({
        id: "abc",
        name: "web",
        state: "running",
        status: "Up 2 hours",
        image: "nginx",
        ports: "80/tcp",
      });
    });

    it("returns empty array when no containers", async () => {
      mockSuccess("");

      const containers = await client.ps();
      expect(containers).toEqual([]);
    });
  });

  describe("logs", () => {
    it("fetches logs with tail and service", async () => {
      mockSuccess("log line 1\nlog line 2\n");

      await client.logs({ tail: 50, service: "web" });

      expect(mockExecFile).toHaveBeenCalledWith(
        "docker",
        ["compose", "logs", "--tail", "50", "web"],
        expect.any(Object),
        expect.any(Function),
      );
    });
  });

  describe("inspect", () => {
    it("parses inspect JSON output", async () => {
      const inspectData = [{ Id: "abc123", State: { Running: true } }];
      mockSuccess(JSON.stringify(inspectData));

      const result = await client.inspect("abc123");

      expect(result).toEqual(inspectData);
    });
  });

  describe("networkLs", () => {
    it("parses network list", async () => {
      mockSuccess(
        '{"ID":"net1","Name":"bridge","Driver":"bridge","Scope":"local"}\n' +
          '{"ID":"net2","Name":"host","Driver":"host","Scope":"local"}\n',
      );

      const networks = await client.networkLs();

      expect(networks).toHaveLength(2);
      expect(networks[0]).toEqual({
        id: "net1",
        name: "bridge",
        driver: "bridge",
        scope: "local",
      });
    });

    it("returns empty array when no networks", async () => {
      mockSuccess("");

      const networks = await client.networkLs();
      expect(networks).toEqual([]);
    });
  });

  describe("imageExists", () => {
    it("returns true when image exists", async () => {
      mockSuccess('[{"Id": "sha256:abc"}]');

      const exists = await client.imageExists("myapp:latest");
      expect(exists).toBe(true);
    });

    it("returns false when image not found", async () => {
      mockFailure("Error: No such image: myapp:latest");

      const exists = await client.imageExists("myapp:latest");
      expect(exists).toBe(false);
    });

    it("rethrows non-ImageNotFound errors", async () => {
      mockFailure("Cannot connect to the Docker daemon");

      await expect(client.imageExists("myapp:latest")).rejects.toThrow(DaemonNotRunning);
    });
  });

  describe("imageInspect", () => {
    it("returns structured image data with layers", async () => {
      const inspectData = [
        {
          Id: "sha256:abc123",
          Created: "2026-01-01T00:00:00Z",
          Size: 524288000,
          RootFS: {
            Layers: ["sha256:layer1", "sha256:layer2", "sha256:layer3"],
          },
          Config: { Cmd: ["/bin/sh"] },
        },
      ];
      mockSuccess(JSON.stringify(inspectData));

      const result = await client.imageInspect("myapp:latest");

      expect(result.id).toBe("sha256:abc123");
      expect(result.layers).toEqual(["sha256:layer1", "sha256:layer2", "sha256:layer3"]);
      expect(result.size).toBe(524288000);
      expect(result.created).toBe("2026-01-01T00:00:00Z");
      expect(result.config).toEqual({ Cmd: ["/bin/sh"] });
    });

    it("throws ImageNotFound when inspect returns empty", async () => {
      mockSuccess("[]");

      await expect(client.imageInspect("nonexistent")).rejects.toThrow(ImageNotFound);
    });
  });

  describe("pollHealth", () => {
    it("returns healthy when container is healthy", async () => {
      mockSuccess("healthy\n");

      const result = await client.pollHealth("container1", {
        timeoutMs: 5000,
        intervalMs: 100,
      });

      expect(result.status).toBe("healthy");
      expect(result.containerId).toBe("container1");
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it("returns unhealthy when container is unhealthy", async () => {
      mockSuccess("unhealthy\n");

      const result = await client.pollHealth("container1", {
        timeoutMs: 5000,
        intervalMs: 100,
      });

      expect(result.status).toBe("unhealthy");
    });

    it("polls until healthy", async () => {
      let callCount = 0;
      mockExecFile.mockImplementation((_cmd, _args, _opts, _cb?) => {
        const cb = typeof _opts === "function" ? _opts : _cb;
        callCount++;
        const status = callCount >= 3 ? "healthy" : "starting";
        if (typeof cb === "function") {
          (cb as (err: null, result: { stdout: string; stderr: string }) => void)(null, {
            stdout: status + "\n",
            stderr: "",
          });
        }
        return undefined as never;
      });

      const result = await client.pollHealth("container1", {
        timeoutMs: 5000,
        intervalMs: 50,
      });

      expect(result.status).toBe("healthy");
      expect(callCount).toBeGreaterThanOrEqual(3);
    });

    it("throws HealthPollTimeout when timeout expires", async () => {
      mockSuccess("starting\n");

      await expect(
        client.pollHealth("container1", {
          timeoutMs: 200,
          intervalMs: 50,
        }),
      ).rejects.toThrow(HealthPollTimeout);
    });

    it("includes last status in timeout error", async () => {
      mockSuccess("starting\n");

      try {
        await client.pollHealth("container1", {
          timeoutMs: 200,
          intervalMs: 50,
        });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(HealthPollTimeout);
        const timeout = err as HealthPollTimeout;
        expect(timeout.lastStatus).toBe("starting");
        expect(timeout.containerId).toBe("container1");
        expect(timeout.timeoutMs).toBe(200);
      }
    });

    it("respects AbortSignal", async () => {
      mockSuccess("starting\n");

      const controller = new AbortController();
      setTimeout(() => controller.abort(), 100);

      await expect(
        client.pollHealth("container1", {
          timeoutMs: 10000,
          intervalMs: 50,
          signal: controller.signal,
        }),
      ).rejects.toThrow();
    });
  });

  describe("AbortSignal support", () => {
    it("passes signal to execFile", async () => {
      mockSuccess("");
      const controller = new AbortController();

      await client.exec(["ps"], { signal: controller.signal });

      expect(mockExecFile).toHaveBeenCalledWith(
        "docker",
        ["ps"],
        expect.objectContaining({ signal: controller.signal }),
        expect.any(Function),
      );
    });

    it("passes signal through compose commands", async () => {
      mockSuccess("");
      const controller = new AbortController();

      await client.up({ signal: controller.signal });

      expect(mockExecFile).toHaveBeenCalledWith(
        "docker",
        ["compose", "up", "-d"],
        expect.objectContaining({ signal: controller.signal }),
        expect.any(Function),
      );
    });
  });
});

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProvisionedInstance } from "./types.js";

// ── Module-level mocks ─────────────────────────────────────────────────────

let mockInstance: ProvisionedInstance | undefined;

vi.mock("./registry.js", async () => {
  const actual = await vi.importActual<typeof import("./registry.js")>("./registry.js");
  return {
    ...actual,
    findInstance: () => mockInstance,
  };
});

// Mock child_process.spawn to simulate SSH execution
let spawnExitCode: number | null = 0;
let spawnStdout = "";
let spawnStderr = "";
let spawnError: Error | undefined;
let capturedSpawnArgs: string[] = [];

vi.mock("node:child_process", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- vi.mock factories are hoisted before imports; require is the only synchronous option
  const { EventEmitter } = require("node:events");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Readable } = require("node:stream");

  return {
    spawn: (_cmd: string, args: string[]) => {
      capturedSpawnArgs = args;
      const proc = new EventEmitter();

      const stdout = new Readable({ read() {} });
      const stderr = new Readable({ read() {} });
      proc.stdout = stdout;
      proc.stderr = stderr;

      // Emit data on next tick, then close on a separate tick so data handlers fire first
      process.nextTick(() => {
        if (spawnError) {
          proc.emit("error", spawnError);
          return;
        }
        if (spawnStdout) stdout.push(Buffer.from(spawnStdout));
        stdout.push(null);
        if (spawnStderr) stderr.push(Buffer.from(spawnStderr));
        stderr.push(null);
        // Delay close so stream data events flush before the close handler resolves the promise
        setTimeout(() => proc.emit("close", spawnExitCode), 0);
      });

      return proc;
    },
  };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

let testDir: string;

function activeInstance(overrides: Partial<ProvisionedInstance> = {}): ProvisionedInstance {
  const keyPath = join(testDir, "keys", "test.pem");
  // Create the key file so existsSync passes
  mkdirSync(join(testDir, "keys"), { recursive: true });
  writeFileSync(keyPath, "fake-key", { mode: 0o600 });

  return {
    id: "inst-001",
    name: "test-agent",
    provider: "digitalocean",
    providerInstanceId: "do-123",
    ipAddress: "10.0.0.1",
    region: "nyc3",
    size: "s-2vcpu-4gb",
    status: "active",
    sshKeyPath: keyPath,
    sshHostKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey",
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "update-test-"));
  mockInstance = undefined;
  spawnExitCode = 0;
  spawnStdout = "";
  spawnStderr = "";
  spawnError = undefined;
  capturedSpawnArgs = [];
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("updateInstance — instance resolution", () => {
  it("returns error when instance not found", async () => {
    mockInstance = undefined;

    const { updateInstance } = await import("./update.js");
    const result = await updateInstance({
      deployDir: testDir,
      instanceId: "missing-id",
      mode: "config",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Instance not found: missing-id");
  });

  it("AC5: error message includes state file path when instance not found", async () => {
    mockInstance = undefined;

    const { updateInstance } = await import("./update.js");
    const result = await updateInstance({
      deployDir: testDir,
      instanceId: "missing-id",
      mode: "config",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("instances.json");
    expect(result.error).toContain("clawhq deploy list");
  });

  it("returns error for instance in provisioning state", async () => {
    mockInstance = activeInstance({ status: "provisioning" });

    const { updateInstance } = await import("./update.js");
    const result = await updateInstance({
      deployDir: testDir,
      instanceId: "inst-001",
      mode: "config",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("provisioning");
    expect(result.error).toContain("active or unhealthy");
  });

  it("allows update on unhealthy instance", async () => {
    mockInstance = activeInstance({ status: "unhealthy" });
    spawnStdout = "ok";

    const { updateInstance } = await import("./update.js");
    const result = await updateInstance({
      deployDir: testDir,
      instanceId: "inst-001",
      mode: "config",
    });

    expect(result.success).toBe(true);
  });

  it("returns error when SSH key path missing from instance", async () => {
    mockInstance = activeInstance({ sshKeyPath: undefined });

    const { updateInstance } = await import("./update.js");
    const result = await updateInstance({
      deployDir: testDir,
      instanceId: "inst-001",
      mode: "config",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("no SSH key path");
  });

  it("returns error when SSH key file does not exist on disk", async () => {
    mockInstance = activeInstance({ sshKeyPath: join(testDir, "keys", "nonexistent.pem") });

    const { updateInstance } = await import("./update.js");
    const result = await updateInstance({
      deployDir: testDir,
      instanceId: "inst-001",
      mode: "config",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("SSH key not found");
    expect(result.error).toContain("Reprovision");
  });
});

describe("updateInstance — config mode", () => {
  it("sends 'clawhq build && clawhq restart' for config update", async () => {
    mockInstance = activeInstance();
    spawnStdout = "Build complete\nRestarted";

    const { updateInstance } = await import("./update.js");
    const result = await updateInstance({
      deployDir: testDir,
      instanceId: "inst-001",
      mode: "config",
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain("Build complete");
    // The remote command is the last arg to SSH
    const remoteCmd = capturedSpawnArgs[capturedSpawnArgs.length - 1];
    expect(remoteCmd).toBe("clawhq build && clawhq restart");
  });
});

describe("updateInstance — version mode", () => {
  it("sends 'clawhq update --yes' for version update", async () => {
    mockInstance = activeInstance();
    spawnStdout = "Updated to v1.2.3";

    const { updateInstance } = await import("./update.js");
    const result = await updateInstance({
      deployDir: testDir,
      instanceId: "inst-001",
      mode: "version",
    });

    expect(result.success).toBe(true);
    const remoteCmd = capturedSpawnArgs[capturedSpawnArgs.length - 1];
    expect(remoteCmd).toBe("clawhq update --yes");
  });
});

describe("updateInstance — skill mode", () => {
  it("sends 'clawhq skill' with escaped args for skill update", async () => {
    mockInstance = activeInstance();
    spawnStdout = "Skill installed";

    const { updateInstance } = await import("./update.js");
    const result = await updateInstance({
      deployDir: testDir,
      instanceId: "inst-001",
      mode: "skill",
      skillArgs: "install email-digest",
    });

    expect(result.success).toBe(true);
    const remoteCmd = capturedSpawnArgs[capturedSpawnArgs.length - 1];
    expect(remoteCmd).toBe("clawhq skill 'install' 'email-digest'");
  });

  it("returns error when skill mode has no skillArgs", async () => {
    mockInstance = activeInstance();

    const { updateInstance } = await import("./update.js");
    const result = await updateInstance({
      deployDir: testDir,
      instanceId: "inst-001",
      mode: "skill",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid update mode");
  });

  it("shell-escapes single quotes in skill args", async () => {
    mockInstance = activeInstance();
    spawnStdout = "ok";

    const { updateInstance } = await import("./update.js");
    await updateInstance({
      deployDir: testDir,
      instanceId: "inst-001",
      mode: "skill",
      skillArgs: "install my'skill",
    });

    const remoteCmd = capturedSpawnArgs[capturedSpawnArgs.length - 1];
    expect(remoteCmd).toBe("clawhq skill 'install' 'my'\\''skill'");
  });
});

describe("updateInstance — SSH execution", () => {
  it("returns error on SSH connection failure", async () => {
    mockInstance = activeInstance();
    spawnError = new Error("connect ECONNREFUSED 10.0.0.1:22");

    const { updateInstance } = await import("./update.js");
    const result = await updateInstance({
      deployDir: testDir,
      instanceId: "inst-001",
      mode: "config",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("SSH connection failed");
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("returns error on non-zero exit code with stderr", async () => {
    mockInstance = activeInstance();
    spawnExitCode = 1;
    spawnStderr = "Permission denied (publickey)";

    const { updateInstance } = await import("./update.js");
    const result = await updateInstance({
      deployDir: testDir,
      instanceId: "inst-001",
      mode: "config",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Remote command failed");
    expect(result.error).toContain("Permission denied");
  });

  it("returns exit code when no stderr/stdout on failure", async () => {
    mockInstance = activeInstance();
    spawnExitCode = 255;

    const { updateInstance } = await import("./update.js");
    const result = await updateInstance({
      deployDir: testDir,
      instanceId: "inst-001",
      mode: "config",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("exit code 255");
  });

  it("uses StrictHostKeyChecking=yes when host key is known", async () => {
    mockInstance = activeInstance({ sshHostKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey" });
    spawnStdout = "ok";

    const { updateInstance } = await import("./update.js");
    await updateInstance({
      deployDir: testDir,
      instanceId: "inst-001",
      mode: "config",
    });

    expect(capturedSpawnArgs).toContain("StrictHostKeyChecking=yes");
  });

  it("uses StrictHostKeyChecking=accept-new when host key is absent", async () => {
    mockInstance = activeInstance({ sshHostKey: undefined });
    spawnStdout = "ok";

    // Suppress the console.warn from buildHostKeyArgs
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { updateInstance } = await import("./update.js");
    await updateInstance({
      deployDir: testDir,
      instanceId: "inst-001",
      mode: "config",
    });

    expect(capturedSpawnArgs).toContain("StrictHostKeyChecking=accept-new");
    warnSpy.mockRestore();
  });

  it("passes SSH key path with -i flag", async () => {
    mockInstance = activeInstance();
    spawnStdout = "ok";

    const { updateInstance } = await import("./update.js");
    await updateInstance({
      deployDir: testDir,
      instanceId: "inst-001",
      mode: "config",
    });

    const keyFlagIdx = capturedSpawnArgs.indexOf("-i");
    expect(keyFlagIdx).toBeGreaterThanOrEqual(0);
    expect(capturedSpawnArgs[keyFlagIdx + 1]).toContain("test.pem");
  });

  it("connects as root user", async () => {
    mockInstance = activeInstance();
    spawnStdout = "ok";

    const { updateInstance } = await import("./update.js");
    await updateInstance({
      deployDir: testDir,
      instanceId: "inst-001",
      mode: "config",
    });

    const userHost = capturedSpawnArgs.find((a) => a.startsWith("root@"));
    expect(userHost).toBe("root@10.0.0.1");
  });
});

describe("updateInstance — progress callbacks", () => {
  it("emits resolve, connect, and execute progress events on success", async () => {
    mockInstance = activeInstance();
    spawnStdout = "ok";

    const events: Array<{ step: string; status: string }> = [];
    const onProgress = (p: { step: string; status: string }) => events.push({ step: p.step, status: p.status });

    const { updateInstance } = await import("./update.js");
    await updateInstance({
      deployDir: testDir,
      instanceId: "inst-001",
      mode: "config",
      onProgress,
    });

    expect(events).toContainEqual({ step: "resolve", status: "running" });
    expect(events).toContainEqual({ step: "resolve", status: "done" });
    expect(events).toContainEqual({ step: "connect", status: "running" });
    expect(events).toContainEqual({ step: "connect", status: "done" });
    expect(events).toContainEqual({ step: "execute", status: "done" });
  });

  it("emits resolve failed when instance not found", async () => {
    mockInstance = undefined;

    const events: Array<{ step: string; status: string }> = [];
    const onProgress = (p: { step: string; status: string }) => events.push({ step: p.step, status: p.status });

    const { updateInstance } = await import("./update.js");
    await updateInstance({
      deployDir: testDir,
      instanceId: "missing",
      mode: "config",
      onProgress,
    });

    expect(events).toContainEqual({ step: "resolve", status: "failed" });
  });
});

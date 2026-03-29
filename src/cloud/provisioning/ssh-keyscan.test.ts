import { describe, expect, it, vi } from "vitest";

import { parseKeyscanOutput } from "./ssh-keyscan.js";

// ── parseKeyscanOutput ──────────────────────────────────────────────────────

describe("parseKeyscanOutput", () => {
  const ip = "10.0.0.1";

  it("extracts ed25519 key from valid ssh-keyscan output", () => {
    const output = `# 10.0.0.1:22 SSH-2.0-OpenSSH_9.6\n${ip} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKey123\n`;
    const key = parseKeyscanOutput(output, ip);
    expect(key).toBe("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKey123");
  });

  it("returns undefined for empty output", () => {
    expect(parseKeyscanOutput("", ip)).toBeUndefined();
  });

  it("returns undefined for comment-only output", () => {
    expect(parseKeyscanOutput("# 10.0.0.1:22 SSH-2.0-OpenSSH_9.6\n", ip)).toBeUndefined();
  });

  it("returns undefined when IP does not match", () => {
    const output = `192.168.1.1 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKey\n`;
    expect(parseKeyscanOutput(output, ip)).toBeUndefined();
  });

  it("returns undefined for non-ed25519 key types", () => {
    const output = `${ip} ssh-rsa AAAAB3NzaC1yc2EAAAADAQSomeRSAKey\n`;
    expect(parseKeyscanOutput(output, ip)).toBeUndefined();
  });

  it("handles output with multiple key types and picks ed25519", () => {
    const output = [
      `${ip} ssh-rsa AAAAB3NzaC1yc2EAAAADAQSomeRSAKey`,
      `${ip} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICorrectKey`,
      `${ip} ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYSomeECKey`,
    ].join("\n");
    expect(parseKeyscanOutput(output, ip)).toBe("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICorrectKey");
  });

  it("ignores lines with fewer than 3 parts", () => {
    const output = `${ip} ssh-ed25519\n`;
    expect(parseKeyscanOutput(output, ip)).toBeUndefined();
  });
});

// ── collectHostKey (mocked at module level to avoid retry delays) ───────────

// collectHostKey integration is tested via engine.test.ts with the full mock.
// Here we test single-invocation behavior by mocking the spawn.

let mockSpawnExitCode: number | null = 0;
let mockSpawnStdout = "";
let mockSpawnError: Error | undefined;

vi.mock("node:child_process", () => {
  const { EventEmitter } = require("node:events");
  const { Readable } = require("node:stream");

  return {
    spawn: () => {
      const proc = new EventEmitter();
      const stdout = new Readable({ read() {} });
      const stderr = new Readable({ read() {} });
      proc.stdout = stdout;
      proc.stderr = stderr;

      process.nextTick(() => {
        if (mockSpawnError) {
          proc.emit("error", mockSpawnError);
          return;
        }
        if (mockSpawnStdout) stdout.push(Buffer.from(mockSpawnStdout));
        stdout.push(null);
        stderr.push(null);
        setTimeout(() => proc.emit("close", mockSpawnExitCode), 0);
      });

      return proc;
    },
  };
});

describe("collectHostKey — success on first attempt (no retry delay)", () => {
  it("returns key on successful first attempt", async () => {
    mockSpawnExitCode = 0;
    mockSpawnStdout = "10.0.0.1 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey\n";
    mockSpawnError = undefined;

    const { collectHostKey } = await import("./ssh-keyscan.js");
    const key = await collectHostKey("10.0.0.1");

    expect(key).toBe("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey");
  });

  it("respects abort signal and returns early", async () => {
    mockSpawnExitCode = 0;
    mockSpawnStdout = "10.0.0.1 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey\n";
    mockSpawnError = undefined;

    const controller = new AbortController();
    controller.abort();

    const { collectHostKey } = await import("./ssh-keyscan.js");
    const key = await collectHostKey("10.0.0.1", controller.signal);

    expect(key).toBeUndefined();
  });
});

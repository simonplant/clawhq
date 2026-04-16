import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireDeployLock, DeployLockBusyError, withDeployLock } from "./lock.js";

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "clawhq-lock-test-"));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("acquireDeployLock", () => {
  it("writes a pidfile and releases it on callback", async () => {
    const release = await acquireDeployLock(testDir);
    const lockPath = join(testDir, ".clawhq.lock");
    expect(existsSync(lockPath)).toBe(true);

    const meta = JSON.parse(readFileSync(lockPath, "utf-8"));
    expect(meta.pid).toBe(process.pid);
    expect(typeof meta.acquiredAt).toBe("string");

    await release();
    expect(existsSync(lockPath)).toBe(false);
  });

  it("throws DeployLockBusyError when lock is held past timeout", async () => {
    // Simulate a live holder: a lock whose PID is `process.pid`, which is
    // definitely alive — no stale reclaim path.
    writeFileSync(
      join(testDir, ".clawhq.lock"),
      JSON.stringify({
        pid: process.pid,
        host: "test",
        acquiredAt: new Date().toISOString(),
        command: "test-holder",
      }),
    );

    await expect(
      acquireDeployLock(testDir, { timeoutMs: 200, retryIntervalMs: 30 }),
    ).rejects.toBeInstanceOf(DeployLockBusyError);
  });

  it("surfaces holder metadata in the busy error", async () => {
    writeFileSync(
      join(testDir, ".clawhq.lock"),
      JSON.stringify({
        pid: process.pid,
        host: "other-host",
        acquiredAt: "2026-01-01T00:00:00.000Z",
        command: "clawhq apply",
      }),
    );

    try {
      await acquireDeployLock(testDir, { timeoutMs: 100, retryIntervalMs: 30 });
      expect.fail("should have thrown");
    } catch (err) {
      if (!(err instanceof DeployLockBusyError)) throw err;
      expect(err.holder.pid).toBe(process.pid);
      expect(err.holder.host).toBe("other-host");
      expect(err.message).toContain("clawhq apply");
      expect(err.message).toContain("other-host");
    }
  });

  it("reclaims a stale lock (holder process dead)", async () => {
    // Write a lock held by a pid that our custom probe reports as dead
    writeFileSync(
      join(testDir, ".clawhq.lock"),
      JSON.stringify({
        pid: 999999,
        host: "gone",
        acquiredAt: new Date().toISOString(),
        command: "crashed",
      }),
    );

    const release = await acquireDeployLock(testDir, {
      timeoutMs: 500,
      retryIntervalMs: 20,
      probePid: () => false, // pretend holder is dead
    });

    const meta = JSON.parse(readFileSync(join(testDir, ".clawhq.lock"), "utf-8"));
    expect(meta.pid).toBe(process.pid);
    await release();
  });

  it("does not reclaim when probe says holder is alive", async () => {
    writeFileSync(
      join(testDir, ".clawhq.lock"),
      JSON.stringify({
        pid: 12345,
        host: "alive",
        acquiredAt: new Date().toISOString(),
        command: "busy",
      }),
    );

    await expect(
      acquireDeployLock(testDir, {
        timeoutMs: 150,
        retryIntervalMs: 20,
        probePid: () => true,
      }),
    ).rejects.toBeInstanceOf(DeployLockBusyError);
  });

  it("creates the parent dir if missing — no, expects it to exist", async () => {
    // Document current behavior: acquireDeployLock assumes deployDir exists.
    // Missing dir → ENOENT propagated; don't silently create.
    const missing = join(testDir, "does-not-exist");
    await expect(acquireDeployLock(missing, { timeoutMs: 50 }))
      .rejects.toThrow(/ENOENT/);
  });
});

describe("withDeployLock", () => {
  it("runs fn with the lock held and releases after", async () => {
    let ranWithLock = false;
    const result = await withDeployLock(testDir, async () => {
      expect(existsSync(join(testDir, ".clawhq.lock"))).toBe(true);
      ranWithLock = true;
      return 42;
    });
    expect(ranWithLock).toBe(true);
    expect(result).toBe(42);
    expect(existsSync(join(testDir, ".clawhq.lock"))).toBe(false);
  });

  it("releases the lock even if fn throws", async () => {
    await expect(
      withDeployLock(testDir, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(existsSync(join(testDir, ".clawhq.lock"))).toBe(false);
  });

  it("serializes concurrent operations on the same deploy", async () => {
    mkdirSync(join(testDir, "artefacts"), { recursive: true });
    const trace: string[] = [];

    const op = async (label: string) =>
      withDeployLock(testDir, async () => {
        trace.push(`${label}:start`);
        await new Promise((r) => setTimeout(r, 30));
        trace.push(`${label}:end`);
      });

    await Promise.all([op("A"), op("B"), op("C")]);

    // Each op must complete (start→end) before the next begins — no
    // interleaving.
    for (let i = 0; i < trace.length; i += 2) {
      const start = trace[i];
      const end = trace[i + 1];
      expect(start.endsWith(":start")).toBe(true);
      expect(end.endsWith(":end")).toBe(true);
      expect(start.slice(0, 1)).toBe(end.slice(0, 1));
    }
  });
});

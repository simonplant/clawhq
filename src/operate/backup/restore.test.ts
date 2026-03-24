import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DIR_MODE_SECRET } from "../../config/defaults.js";

// Track mkdirSync calls made by the restore module
const mkdirCalls: Array<[string, object | undefined]> = [];

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    mkdirSync: (...args: Parameters<typeof actual.mkdirSync>) => {
      mkdirCalls.push([args[0] as string, args[1] as object | undefined]);
      return actual.mkdirSync(...args);
    },
  };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "clawhq-restore-test-"));
  mkdirCalls.length = 0;
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("restore — temp directory permissions", () => {
  it("mkdirSync calls for tempDir and extractDir pass mode DIR_MODE_SECRET", async () => {
    const { restoreBackup } = await import("./restore.js");

    // Create a fake snapshot that passes resolveSnapshot — absolute .gpg path
    // with an adjacent manifest whose sha256 matches the fake data.
    const fakeGpg = join(testDir, "snap.tar.gz.gpg");
    const fakeManifest = join(testDir, "snap.manifest.json");
    writeFileSync(fakeGpg, "not-real-gpg-data");
    const realHash = createHash("sha256").update("not-real-gpg-data").digest("hex");
    writeFileSync(fakeManifest, JSON.stringify({ sha256: realHash }));

    mkdirCalls.length = 0;

    // Restore will fail at GPG decryption — that's expected.
    // The tempDir mkdirSync is called after resolveSnapshot succeeds.
    const result = await restoreBackup({
      deployDir: testDir,
      snapshot: fakeGpg,
      passphrase: "test",
    });

    expect(result.success).toBe(false);

    // Find mkdirSync calls targeting the clawhq-restore temp directory
    const restoreCalls = mkdirCalls.filter(
      ([path]) => path.includes("clawhq-restore-"),
    );

    // tempDir creation must have been called (happens before GPG decrypt)
    expect(restoreCalls.length).toBeGreaterThanOrEqual(1);

    // Every restore-related mkdirSync must pass mode: DIR_MODE_SECRET
    for (const [, opts] of restoreCalls) {
      expect((opts as { mode?: number })?.mode).toBe(DIR_MODE_SECRET);
    }
  });
});

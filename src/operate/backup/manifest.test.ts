import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createManifest,
  generateBackupId,
  readManifest,
  validateIntegrity,
  writeManifest,
} from "./manifest.js";
import type { BackupFileEntry, BackupManifest } from "./types.js";

describe("generateBackupId", () => {
  it("produces a string starting with backup-", () => {
    const id = generateBackupId();
    expect(id).toMatch(/^backup-/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 10 }, () => generateBackupId()));
    expect(ids.size).toBe(10);
  });
});

describe("createManifest", () => {
  const files: BackupFileEntry[] = [
    { path: "openclaw.json", size: 1024, hash: "abc123" },
    { path: ".env", size: 256, hash: "def456" },
  ];

  it("creates manifest with correct fields", () => {
    const manifest = createManifest("backup-test-001", files, false);
    expect(manifest.backupId).toBe("backup-test-001");
    expect(manifest.secretsOnly).toBe(false);
    expect(manifest.files).toHaveLength(2);
    expect(manifest.totalSize).toBe(1280);
    expect(manifest.version).toBe(1);
    expect(manifest.timestamp).toBeTruthy();
  });

  it("sets secretsOnly flag correctly", () => {
    const manifest = createManifest("backup-test-002", files, true);
    expect(manifest.secretsOnly).toBe(true);
  });
});

describe("writeManifest / readManifest", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-manifest-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes and reads back a manifest", async () => {
    const original = createManifest(
      "backup-test-rw",
      [{ path: "test.txt", size: 100, hash: "aaa" }],
      false,
    );

    await writeManifest(original, tmpDir);

    const read = await readManifest(tmpDir, "backup-test-rw");
    expect(read).not.toBeNull();
    const restored = read as BackupManifest;
    expect(restored.backupId).toBe("backup-test-rw");
    expect(restored.files).toHaveLength(1);
    expect(restored.totalSize).toBe(100);
  });

  it("returns null for nonexistent backup", async () => {
    const result = await readManifest(tmpDir, "does-not-exist");
    expect(result).toBeNull();
  });

  it("writes valid JSON", async () => {
    const manifest = createManifest("backup-json-test", [], false);
    const path = await writeManifest(manifest, tmpDir);
    const content = await readFile(path, "utf-8");
    const parsed = JSON.parse(content) as BackupManifest;
    expect(parsed.backupId).toBe("backup-json-test");
  });
});

describe("validateIntegrity", () => {
  const manifest: BackupManifest = {
    backupId: "test",
    timestamp: new Date().toISOString(),
    version: 1,
    secretsOnly: false,
    totalSize: 200,
    files: [
      { path: "a.txt", size: 100, hash: "hash-a" },
      { path: "b.txt", size: 100, hash: "hash-b" },
    ],
  };

  it("returns empty array when all hashes match", () => {
    const hashes = new Map([
      ["a.txt", "hash-a"],
      ["b.txt", "hash-b"],
    ]);
    const failures = validateIntegrity(manifest, hashes);
    expect(failures).toHaveLength(0);
  });

  it("returns failed files when hashes differ", () => {
    const hashes = new Map([
      ["a.txt", "hash-a"],
      ["b.txt", "wrong-hash"],
    ]);
    const failures = validateIntegrity(manifest, hashes);
    expect(failures).toEqual(["b.txt"]);
  });

  it("returns failed files when file is missing", () => {
    const hashes = new Map([["a.txt", "hash-a"]]);
    const failures = validateIntegrity(manifest, hashes);
    expect(failures).toEqual(["b.txt"]);
  });
});

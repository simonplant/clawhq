import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { collectFiles, hashFile } from "./snapshot.js";
import type { BackupOptions } from "./types.js";

describe("hashFile", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-hash-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("produces consistent SHA-256 hash", async () => {
    const filePath = join(tmpDir, "test.txt");
    await writeFile(filePath, "hello world", "utf-8");

    const hash1 = await hashFile(filePath);
    const hash2 = await hashFile(filePath);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex
  });

  it("produces different hashes for different content", async () => {
    const file1 = join(tmpDir, "a.txt");
    const file2 = join(tmpDir, "b.txt");
    await writeFile(file1, "content-a", "utf-8");
    await writeFile(file2, "content-b", "utf-8");

    const hash1 = await hashFile(file1);
    const hash2 = await hashFile(file2);
    expect(hash1).not.toBe(hash2);
  });
});

describe("collectFiles", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-collect-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function makeOpts(overrides?: Partial<BackupOptions>): BackupOptions {
    return {
      openclawHome: tmpDir,
      backupDir: join(tmpDir, "backups"),
      gpgRecipient: "test@example.com",
      ...overrides,
    };
  }

  it("collects existing files", async () => {
    await writeFile(join(tmpDir, "openclaw.json"), '{"test": true}', "utf-8");
    await writeFile(join(tmpDir, ".env"), "KEY=value", "utf-8");

    const files = await collectFiles(makeOpts());

    const paths = files.map((f) => f.path);
    expect(paths).toContain("openclaw.json");
    expect(paths).toContain(".env");
  });

  it("skips missing files without error", async () => {
    // Only .env exists, no openclaw.json
    await writeFile(join(tmpDir, ".env"), "KEY=value", "utf-8");

    const files = await collectFiles(makeOpts());
    const paths = files.map((f) => f.path);
    expect(paths).toContain(".env");
    expect(paths).not.toContain("openclaw.json");
  });

  it("collects files recursively from directories", async () => {
    await mkdir(join(tmpDir, "workspace"), { recursive: true });
    await writeFile(join(tmpDir, "workspace", "identity.md"), "# Identity", "utf-8");

    const files = await collectFiles(makeOpts());
    const paths = files.map((f) => f.path);
    expect(paths).toContain(join("workspace", "identity.md"));
  });

  it("in secrets-only mode only collects .env", async () => {
    await writeFile(join(tmpDir, "openclaw.json"), '{"test": true}', "utf-8");
    await writeFile(join(tmpDir, ".env"), "KEY=value", "utf-8");

    const files = await collectFiles(makeOpts({ secretsOnly: true }));
    const paths = files.map((f) => f.path);
    expect(paths).toEqual([".env"]);
  });

  it("returns empty array for empty directory", async () => {
    const files = await collectFiles(makeOpts());
    expect(files).toHaveLength(0);
  });

  it("computes file hashes and sizes", async () => {
    await writeFile(join(tmpDir, ".env"), "SECRET=abc", "utf-8");

    const files = await collectFiles(makeOpts());
    expect(files[0].hash).toHaveLength(64);
    expect(files[0].size).toBeGreaterThan(0);
  });
});

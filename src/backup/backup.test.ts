import { writeFileSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBackup } from "./backup.js";
import { BackupError } from "./types.js";

// Mock GPG and tar — these are external system tools
vi.mock("node:child_process", async () => {
  const { writeFileSync: wfs } = await vi.importActual<typeof import("node:fs")>("node:fs");

  const execFileFn = (
    cmd: string,
    args: string[],
    callback: (err: Error | null, result: { stdout: string; stderr: string }) => void,
  ) => {
    if (cmd === "tar" && args[0] === "cf") {
      wfs(args[1], "fake-tar-content");
      callback(null, { stdout: "", stderr: "" });
    } else if (cmd === "gpg" && args.includes("--encrypt")) {
      const outputIdx = args.indexOf("--output") + 1;
      wfs(args[outputIdx], "fake-encrypted-content");
      callback(null, { stdout: "", stderr: "" });
    } else {
      callback(null, { stdout: "", stderr: "" });
    }
  };

  return { execFile: execFileFn };
});

// Suppress unused import warning
void writeFileSync;

describe("createBackup", () => {
  let tmpDir: string;
  let backupDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-backup-${Date.now()}`);
    backupDir = join(tmpDir, "backups");
    await mkdir(tmpDir, { recursive: true });
    await mkdir(backupDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("creates a backup with manifest and encrypted archive", async () => {
    await writeFile(join(tmpDir, "openclaw.json"), '{"config": true}', "utf-8");
    await writeFile(join(tmpDir, ".env"), "API_KEY=test123", "utf-8");

    const result = await createBackup({
      openclawHome: tmpDir,
      backupDir,
      gpgRecipient: "test@example.com",
    });

    expect(result.backupId).toMatch(/^backup-/);
    expect(result.manifest.files.length).toBeGreaterThan(0);
    expect(result.manifest.secretsOnly).toBe(false);

    // Verify backup directory was created
    const backupContents = await readdir(join(backupDir, result.backupId));
    expect(backupContents).toContain("manifest.json");
    expect(backupContents).toContain("archive.tar.gpg");
  });

  it("creates secrets-only backup", async () => {
    await writeFile(join(tmpDir, "openclaw.json"), '{"config": true}', "utf-8");
    await writeFile(join(tmpDir, ".env"), "API_KEY=test123", "utf-8");

    const result = await createBackup({
      openclawHome: tmpDir,
      backupDir,
      gpgRecipient: "test@example.com",
      secretsOnly: true,
    });

    expect(result.manifest.secretsOnly).toBe(true);
    const paths = result.manifest.files.map((f) => f.path);
    expect(paths).toEqual([".env"]);
  });

  it("throws when no files found", async () => {
    await expect(
      createBackup({
        openclawHome: tmpDir,
        backupDir,
        gpgRecipient: "test@example.com",
      }),
    ).rejects.toThrow(BackupError);
  });

  it("includes file hashes in manifest", async () => {
    await writeFile(join(tmpDir, ".env"), "SECRET=value", "utf-8");

    const result = await createBackup({
      openclawHome: tmpDir,
      backupDir,
      gpgRecipient: "test@example.com",
    });

    for (const file of result.manifest.files) {
      expect(file.hash).toHaveLength(64);
      expect(file.size).toBeGreaterThan(0);
    }
  });
});

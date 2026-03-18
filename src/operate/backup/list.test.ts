import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { formatBackupTable, listBackups } from "./list.js";
import type { BackupManifest } from "./types.js";

describe("listBackups", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-list-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function createFakeBackup(
    id: string,
    timestamp: string,
    secretsOnly = false,
  ): Promise<void> {
    const dir = join(tmpDir, id);
    await mkdir(dir, { recursive: true });

    const manifest: BackupManifest = {
      backupId: id,
      timestamp,
      version: 1,
      secretsOnly,
      files: [{ path: ".env", size: 128, hash: "abc" }],
      totalSize: 128,
    };

    await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest), "utf-8");
    await writeFile(join(dir, "archive.tar.gpg"), "fake-encrypted-data", "utf-8");
  }

  it("returns empty array for empty directory", async () => {
    const backups = await listBackups(tmpDir);
    expect(backups).toHaveLength(0);
  });

  it("returns empty array for nonexistent directory", async () => {
    const backups = await listBackups("/nonexistent/path");
    expect(backups).toHaveLength(0);
  });

  it("lists backups sorted newest first", async () => {
    await createFakeBackup("backup-older", "2026-03-10T10:00:00.000Z");
    await createFakeBackup("backup-newer", "2026-03-12T10:00:00.000Z");

    const backups = await listBackups(tmpDir);
    expect(backups).toHaveLength(2);
    expect(backups[0].backupId).toBe("backup-newer");
    expect(backups[1].backupId).toBe("backup-older");
  });

  it("includes secretsOnly flag", async () => {
    await createFakeBackup("backup-full", "2026-03-10T10:00:00.000Z", false);
    await createFakeBackup("backup-secrets", "2026-03-11T10:00:00.000Z", true);

    const backups = await listBackups(tmpDir);
    const secrets = backups.find((b) => b.backupId === "backup-secrets");
    const full = backups.find((b) => b.backupId === "backup-full");
    expect(secrets?.secretsOnly).toBe(true);
    expect(full?.secretsOnly).toBe(false);
  });

  it("ignores non-backup directories", async () => {
    await mkdir(join(tmpDir, "random-dir"), { recursive: true });
    await createFakeBackup("backup-real", "2026-03-10T10:00:00.000Z");

    const backups = await listBackups(tmpDir);
    expect(backups).toHaveLength(1);
    expect(backups[0].backupId).toBe("backup-real");
  });
});

describe("formatBackupTable", () => {
  it("shows 'No backups found' for empty list", () => {
    const output = formatBackupTable([]);
    expect(output).toBe("No backups found.");
  });

  it("formats backup entries as table", () => {
    const output = formatBackupTable([
      {
        backupId: "backup-2026-03-12",
        timestamp: "2026-03-12T10:00:00.000Z",
        secretsOnly: false,
        totalSize: 2048,
        archivePath: "/tmp/archive.tar.gpg",
      },
    ]);

    expect(output).toContain("backup-2026-03-12");
    expect(output).toContain("full");
    expect(output).toContain("2.0 KB");
    expect(output).toContain("1 backup found.");
  });

  it("shows correct count for multiple backups", () => {
    const output = formatBackupTable([
      {
        backupId: "backup-1",
        timestamp: "2026-03-12T10:00:00.000Z",
        secretsOnly: false,
        totalSize: 1024,
        archivePath: "/tmp/1.tar.gpg",
      },
      {
        backupId: "backup-2",
        timestamp: "2026-03-11T10:00:00.000Z",
        secretsOnly: true,
        totalSize: 256,
        archivePath: "/tmp/2.tar.gpg",
      },
    ]);

    expect(output).toContain("2 backups found.");
    expect(output).toContain("secrets-only");
  });
});

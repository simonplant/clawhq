import { writeFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { restoreBackup } from "./restore.js";
import { BackupError } from "./types.js";

// Mock GPG and tar — external system tools
vi.mock("node:child_process", async () => {
  const nodefs = await vi.importActual<typeof import("node:fs")>("node:fs");
  const nodepath = await vi.importActual<typeof import("node:path")>("node:path");

  const execFileFn = (
    cmd: string,
    args: string[],
    callback: (err: Error | null, result: { stdout: string; stderr: string }) => void,
  ) => {
    if (cmd === "gpg" && args.includes("--decrypt")) {
      // Copy the tar from _source to the output path
      const outputIdx = args.indexOf("--output") + 1;
      const inputPath = args[args.length - 1];
      // Write a valid tar-like placeholder (the tar mock handles extraction)
      const sourceTar = inputPath.replace(".tar.gpg", ".tar");
      try {
        const data = nodefs.readFileSync(sourceTar);
        nodefs.writeFileSync(args[outputIdx], data);
      } catch {
        nodefs.writeFileSync(args[outputIdx], "decrypted-tar-content");
      }
      callback(null, { stdout: "", stderr: "" });
    } else if (cmd === "tar" && args[0] === "xf") {
      // Extract: copy files from the _source dir to the target
      const targetDir = args[args.indexOf("-C") + 1];
      // Find the backup dir (parent of the archive) and read manifest to know what files to create
      const archivePath = args[1];
      const backupDir = nodepath.dirname(archivePath);
      const manifestPath = nodepath.join(backupDir, "manifest.json");
      try {
        const manifest = JSON.parse(nodefs.readFileSync(manifestPath, "utf-8"));
        for (const file of manifest.files) {
          const filePath = nodepath.join(targetDir, file.path);
          const dir = nodepath.dirname(filePath);
          nodefs.mkdirSync(dir, { recursive: true });
          // Write content that matches the expected hash
          const sourceDir = backupDir.replace(/[/\\]backups[/\\][^/\\]+/, "");
          const sourcePath = nodepath.join(sourceDir, "_source", file.path);
          try {
            const content = nodefs.readFileSync(sourcePath);
            nodefs.writeFileSync(filePath, content);
          } catch {
            nodefs.writeFileSync(filePath, `content-of-${file.path}`);
          }
        }
      } catch {
        // If no manifest, just do nothing
      }
      callback(null, { stdout: "", stderr: "" });
    } else if (cmd === "tar" && args[0] === "cf") {
      nodefs.writeFileSync(args[1], "fake-tar-content");
      callback(null, { stdout: "", stderr: "" });
    } else if (cmd === "gpg" && args.includes("--encrypt")) {
      const outputIdx = args.indexOf("--output") + 1;
      nodefs.writeFileSync(args[outputIdx], "fake-encrypted-content");
      callback(null, { stdout: "", stderr: "" });
    } else if (cmd === "docker") {
      callback(null, { stdout: "{}", stderr: "" });
    } else {
      callback(null, { stdout: "", stderr: "" });
    }
  };

  return { execFile: execFileFn };
});

// Mock doctor to avoid running real checks during restore tests
vi.mock("../doctor/runner.js", () => ({
  runChecks: vi.fn().mockResolvedValue({
    checks: [],
    passed: true,
    counts: { pass: 0, warn: 0, fail: 0 },
  }),
}));

// Suppress unused import warning
void writeFileSync;

describe("restoreBackup", () => {
  let tmpDir: string;
  let backupDir: string;
  let openclawHome: string;
  let sourceDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-restore-${Date.now()}`);
    backupDir = join(tmpDir, "backups");
    openclawHome = join(tmpDir, "openclaw");
    sourceDir = join(tmpDir, "_source");
    await mkdir(backupDir, { recursive: true });
    await mkdir(openclawHome, { recursive: true });
    await mkdir(sourceDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function createFakeBackup(
    id: string,
    files: { path: string; content: string }[],
    secretsOnly = false,
  ): Promise<void> {
    const { createHash } = await import("node:crypto");
    const dir = join(backupDir, id);
    await mkdir(dir, { recursive: true });

    const manifestFiles = [];
    for (const file of files) {
      const hash = createHash("sha256").update(file.content).digest("hex");
      manifestFiles.push({
        path: file.path,
        size: Buffer.byteLength(file.content),
        hash,
      });

      // Write source file so tar mock can copy it
      const sourcePath = join(sourceDir, file.path);
      await mkdir(join(sourcePath, ".."), { recursive: true });
      await writeFile(sourcePath, file.content, "utf-8");
    }

    const manifest = {
      backupId: id,
      timestamp: new Date().toISOString(),
      version: 1,
      secretsOnly,
      files: manifestFiles,
      totalSize: manifestFiles.reduce((s, f) => s + f.size, 0),
    };

    await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest), "utf-8");
    await writeFile(join(dir, "archive.tar.gpg"), "fake-encrypted-data", "utf-8");
    // Also write the unencrypted tar for the mock to copy during decrypt
    await writeFile(join(dir, "archive.tar"), "fake-tar-content", "utf-8");
  }

  it("restores backup and reports success", async () => {
    await createFakeBackup("backup-test-restore", [
      { path: ".env", content: "API_KEY=secret123" },
      { path: "openclaw.json", content: '{"config": true}' },
    ]);

    const result = await restoreBackup({
      backupId: "backup-test-restore",
      backupDir,
      openclawHome,
    });

    expect(result.backupId).toBe("backup-test-restore");
    expect(result.filesRestored).toBeGreaterThan(0);
    expect(result.integrityPassed).toBe(true);
  });

  it("includes doctor results in restore output", async () => {
    await createFakeBackup("backup-doctor-test", [
      { path: ".env", content: "KEY=val" },
    ]);

    const result = await restoreBackup({
      backupId: "backup-doctor-test",
      backupDir,
      openclawHome,
    });

    expect(result).toHaveProperty("doctorPassed");
    expect(result).toHaveProperty("doctorChecks");
    expect(result.doctorPassed).toBe(true);
    expect(result.doctorChecks).toEqual({ pass: 0, warn: 0, fail: 0 });
  });

  it("reports doctor failure without throwing", async () => {
    const { runChecks } = await import("../doctor/runner.js");
    vi.mocked(runChecks).mockResolvedValueOnce({
      checks: [{ name: "test-check", status: "fail", message: "broken", fix: "" }],
      passed: false,
      counts: { pass: 0, warn: 0, fail: 1 },
    });

    await createFakeBackup("backup-doctor-fail", [
      { path: ".env", content: "KEY=val" },
    ]);

    const result = await restoreBackup({
      backupId: "backup-doctor-fail",
      backupDir,
      openclawHome,
    });

    expect(result.integrityPassed).toBe(true);
    expect(result.doctorPassed).toBe(false);
    expect(result.doctorChecks.fail).toBe(1);
  });

  it("throws BackupError when backup not found", async () => {
    await expect(
      restoreBackup({
        backupId: "nonexistent-backup",
        backupDir,
        openclawHome,
      }),
    ).rejects.toThrow(BackupError);
  });

  it("throws BackupError with BACKUP_NOT_FOUND code", async () => {
    try {
      await restoreBackup({
        backupId: "nonexistent",
        backupDir,
        openclawHome,
      });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BackupError);
      expect((err as BackupError).code).toBe("BACKUP_NOT_FOUND");
    }
  });

  it("restores secrets-only backup", async () => {
    await createFakeBackup(
      "backup-secrets-only",
      [{ path: ".env", content: "SECRET=value" }],
      true,
    );

    const result = await restoreBackup({
      backupId: "backup-secrets-only",
      backupDir,
      openclawHome,
    });

    expect(result.backupId).toBe("backup-secrets-only");
    expect(result.integrityPassed).toBe(true);
  });

  it("cleans up temp files after restore", async () => {
    const { stat } = await import("node:fs/promises");

    await createFakeBackup("backup-cleanup", [
      { path: ".env", content: "KEY=val" },
    ]);

    await restoreBackup({
      backupId: "backup-cleanup",
      backupDir,
      openclawHome,
    });

    // Decrypted archive and temp dir should be cleaned up
    const decryptedPath = join(backupDir, "backup-cleanup", "archive.tar");
    const tempDir = join(backupDir, "backup-cleanup", "_restore_tmp");

    await expect(stat(decryptedPath)).rejects.toThrow();
    await expect(stat(tempDir)).rejects.toThrow();
  });
});

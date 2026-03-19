/**
 * Tests for encrypted backup and restore operations.
 *
 * Covers:
 *   - Backup creation with GPG encryption
 *   - SHA-256 integrity verification
 *   - Snapshot listing
 *   - Restore with integrity check
 *   - Temp directory isolation during restore
 *   - Post-restore doctor check
 *   - Tampered snapshot detection
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBackup, listSnapshots } from "./backup.js";
import { restoreBackup } from "./restore.js";

// ── Test Setup ──────────────────────────────────────────────────────────────

let testDir: string;
let deployDir: string;

const TEST_PASSPHRASE = "test-passphrase-12345";

/** Scaffold a minimal deployment directory for testing. */
function scaffoldDeployDir(dir: string): void {
  mkdirSync(join(dir, "engine"), { recursive: true });
  mkdirSync(join(dir, "workspace", "identity"), { recursive: true });
  mkdirSync(join(dir, "workspace", "tools"), { recursive: true });
  mkdirSync(join(dir, "workspace", "skills"), { recursive: true });
  mkdirSync(join(dir, "workspace", "memory"), { recursive: true });
  mkdirSync(join(dir, "cron"), { recursive: true });
  mkdirSync(join(dir, "security"), { recursive: true });
  mkdirSync(join(dir, "ops", "audit"), { recursive: true });

  writeFileSync(
    join(dir, "engine", "openclaw.json"),
    JSON.stringify({ name: "test-agent", version: "1.0" }),
  );
  writeFileSync(
    join(dir, "engine", "docker-compose.yml"),
    "version: '3.8'\nservices:\n  openclaw:\n    image: openclaw:latest\n",
  );
  writeFileSync(join(dir, "engine", ".env"), "API_KEY=sk-secret-key-12345\n");
  writeFileSync(
    join(dir, "engine", "credentials.json"),
    JSON.stringify({ icloud: { password: "secret" } }),
  );
  writeFileSync(
    join(dir, "workspace", "identity", "SOUL.md"),
    "You are a helpful assistant.\n",
  );
  writeFileSync(
    join(dir, "cron", "jobs.json"),
    JSON.stringify({ jobs: [{ name: "digest", cron: "0 8 * * *" }] }),
  );
  writeFileSync(join(dir, "security", "posture.yaml"), "posture: hardened\n");
}

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "clawhq-backup-test-"));
  deployDir = join(testDir, ".clawhq");
  scaffoldDeployDir(deployDir);
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ── Backup Creation Tests ───────────────────────────────────────────────────

describe("createBackup", () => {
  it("creates an encrypted snapshot", async () => {
    const result = await createBackup({
      deployDir,
      passphrase: TEST_PASSPHRASE,
    });

    expect(result.success).toBe(true);
    expect(result.snapshotId).toBeDefined();
    expect(result.snapshotPath).toBeDefined();
    if (result.snapshotPath) {
      expect(existsSync(result.snapshotPath)).toBe(true);
      expect(result.snapshotPath).toMatch(/\.tar\.gz\.gpg$/);
    }
  });

  it("writes a manifest with SHA-256 hash", async () => {
    const result = await createBackup({
      deployDir,
      passphrase: TEST_PASSPHRASE,
    });

    expect(result.manifest).toBeDefined();
    if (result.manifest) {
      expect(result.manifest.version).toBe(1);
      expect(result.manifest.sha256).toHaveLength(64);
      expect(result.manifest.fileCount).toBeGreaterThan(0);
      expect(result.manifest.archiveSize).toBeGreaterThan(0);
      expect(result.manifest.snapshotId).toBe(result.snapshotId);
    }
  });

  it("manifest SHA-256 matches actual encrypted file hash", async () => {
    const result = await createBackup({
      deployDir,
      passphrase: TEST_PASSPHRASE,
    });

    expect(result.manifest).toBeDefined();
    expect(result.snapshotPath).toBeDefined();
    if (result.manifest && result.snapshotPath) {
      const content = readFileSync(result.snapshotPath);
      const actualHash = createHash("sha256").update(content).digest("hex");
      expect(actualHash).toBe(result.manifest.sha256);
    }
  });

  it("removes unencrypted archive after encryption", async () => {
    const result = await createBackup({
      deployDir,
      passphrase: TEST_PASSPHRASE,
    });

    expect(result.success).toBe(true);
    if (result.snapshotPath) {
      // The unencrypted .tar.gz should be cleaned up
      const unencryptedPath = result.snapshotPath.replace(/\.gpg$/, "");
      expect(existsSync(unencryptedPath)).toBe(false);
    }
  });

  it("reports progress callbacks", async () => {
    const steps: string[] = [];
    await createBackup({
      deployDir,
      passphrase: TEST_PASSPHRASE,
      onProgress: (event) => steps.push(`${event.step}:${event.status}`),
    });

    expect(steps).toContain("collect:running");
    expect(steps).toContain("collect:done");
    expect(steps).toContain("archive:running");
    expect(steps).toContain("archive:done");
    expect(steps).toContain("encrypt:running");
    expect(steps).toContain("encrypt:done");
    expect(steps).toContain("integrity:running");
    expect(steps).toContain("integrity:done");
    expect(steps).toContain("cleanup:done");
  });

  it("rejects short passphrase", async () => {
    const result = await createBackup({
      deployDir,
      passphrase: "short",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("at least 8 characters");
  });

  it("fails gracefully for missing deploy dir", async () => {
    const result = await createBackup({
      deployDir: "/nonexistent/path",
      passphrase: TEST_PASSPHRASE,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("excludes snapshots directory from backup", async () => {
    // Create a first backup
    const first = await createBackup({ deployDir, passphrase: TEST_PASSPHRASE });
    expect(first.success).toBe(true);

    // Create a second backup — should not include the first snapshot
    const second = await createBackup({ deployDir, passphrase: TEST_PASSPHRASE });
    expect(second.success).toBe(true);

    // Second backup should have the same file count (no recursive growth)
    if (first.manifest && second.manifest) {
      expect(second.manifest.fileCount).toBe(first.manifest.fileCount);
    }
  });
});

// ── List Snapshots Tests ────────────────────────────────────────────────────

describe("listSnapshots", () => {
  it("returns empty array when no snapshots exist", async () => {
    const snapshots = await listSnapshots(deployDir);
    expect(snapshots).toEqual([]);
  });

  it("lists created snapshots", async () => {
    await createBackup({ deployDir, passphrase: TEST_PASSPHRASE });
    await createBackup({ deployDir, passphrase: TEST_PASSPHRASE });

    const snapshots = await listSnapshots(deployDir);
    expect(snapshots).toHaveLength(2);
  });

  it("returns snapshots sorted newest first", async () => {
    await createBackup({ deployDir, passphrase: TEST_PASSPHRASE });
    await createBackup({ deployDir, passphrase: TEST_PASSPHRASE });

    const snapshots = await listSnapshots(deployDir);
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    // Verify sorted newest first
    for (let i = 0; i < snapshots.length - 1; i++) {
      expect(snapshots[i].createdAt >= snapshots[i + 1].createdAt).toBe(true);
    }
  });

  it("includes correct metadata", async () => {
    const result = await createBackup({ deployDir, passphrase: TEST_PASSPHRASE });
    expect(result.success).toBe(true);

    const snapshots = await listSnapshots(deployDir);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].snapshotId).toBe(result.snapshotId);
    expect(snapshots[0].sha256).toHaveLength(64);
    expect(snapshots[0].fileCount).toBeGreaterThan(0);
    expect(snapshots[0].archiveSize).toBeGreaterThan(0);
  });
});

// ── Restore Tests ───────────────────────────────────────────────────────────

describe("restoreBackup", () => {
  it("restores from a snapshot by ID", async () => {
    const backup = await createBackup({ deployDir, passphrase: TEST_PASSPHRASE });
    expect(backup.success).toBe(true);
    expect(backup.snapshotId).toBeDefined();
    if (!backup.snapshotId) return;

    // Wipe some agent data to simulate data loss
    await rm(join(deployDir, "workspace", "identity", "SOUL.md"));
    expect(existsSync(join(deployDir, "workspace", "identity", "SOUL.md"))).toBe(false);

    const result = await restoreBackup({
      deployDir,
      snapshot: backup.snapshotId,
      passphrase: TEST_PASSPHRASE,
    });

    expect(result.success).toBe(true);
    expect(result.fileCount).toBeGreaterThan(0);
    // SOUL.md should be restored
    expect(existsSync(join(deployDir, "workspace", "identity", "SOUL.md"))).toBe(true);
  });

  it("verifies SHA-256 integrity before restore", async () => {
    const backup = await createBackup({ deployDir, passphrase: TEST_PASSPHRASE });
    expect(backup.success).toBe(true);
    expect(backup.snapshotPath).toBeDefined();
    if (!backup.snapshotPath || !backup.snapshotId) return;

    // Tamper with the encrypted file
    const original = readFileSync(backup.snapshotPath);
    const tampered = Buffer.concat([original, Buffer.from("tampered")]);
    writeFileSync(backup.snapshotPath, tampered);

    const result = await restoreBackup({
      deployDir,
      snapshot: backup.snapshotId,
      passphrase: TEST_PASSPHRASE,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Integrity check failed");
  });

  it("fails with wrong passphrase", async () => {
    const backup = await createBackup({ deployDir, passphrase: TEST_PASSPHRASE });
    expect(backup.success).toBe(true);
    if (!backup.snapshotId) return;

    const result = await restoreBackup({
      deployDir,
      snapshot: backup.snapshotId,
      passphrase: "wrong-passphrase-12345",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Restore failed");
  });

  it("runs post-restore doctor check", async () => {
    const backup = await createBackup({ deployDir, passphrase: TEST_PASSPHRASE });
    expect(backup.success).toBe(true);
    if (!backup.snapshotId) return;

    const result = await restoreBackup({
      deployDir,
      snapshot: backup.snapshotId,
      passphrase: TEST_PASSPHRASE,
    });

    expect(result.success).toBe(true);
    // doctorHealthy is set (may or may not pass depending on Docker availability)
    expect(result.doctorHealthy).toBeDefined();
  });

  it("reports progress callbacks", async () => {
    const backup = await createBackup({ deployDir, passphrase: TEST_PASSPHRASE });
    expect(backup.success).toBe(true);
    if (!backup.snapshotId) return;

    const steps: string[] = [];
    await restoreBackup({
      deployDir,
      snapshot: backup.snapshotId,
      passphrase: TEST_PASSPHRASE,
      onProgress: (event) => steps.push(`${event.step}:${event.status}`),
    });

    expect(steps).toContain("verify:running");
    expect(steps).toContain("verify:done");
    expect(steps).toContain("decrypt:running");
    expect(steps).toContain("decrypt:done");
    expect(steps).toContain("extract:running");
    expect(steps).toContain("extract:done");
    expect(steps).toContain("apply:running");
    expect(steps).toContain("apply:done");
    expect(steps).toContain("doctor:running");
    expect(steps).toContain("cleanup:done");
  });

  it("fails for nonexistent snapshot", async () => {
    const result = await restoreBackup({
      deployDir,
      snapshot: "snap-nonexistent",
      passphrase: TEST_PASSPHRASE,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("preserves existing snapshots during restore", async () => {
    // Create two backups
    const first = await createBackup({ deployDir, passphrase: TEST_PASSPHRASE });
    const second = await createBackup({ deployDir, passphrase: TEST_PASSPHRASE });
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    if (!first.snapshotId) return;

    // Restore from first backup
    await restoreBackup({
      deployDir,
      snapshot: first.snapshotId,
      passphrase: TEST_PASSPHRASE,
    });

    // Both snapshots should still be listed
    const snapshots = await listSnapshots(deployDir);
    const ids = snapshots.map((s) => s.snapshotId);
    expect(ids).toContain(first.snapshotId);
    expect(ids).toContain(second.snapshotId);
  });
});

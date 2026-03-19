/**
 * Safe upstream update with automatic rollback on failure.
 *
 * Pipeline: check → backup → pull → restart → verify → (rollback on failure)
 *
 * Never throws — returns structured result. Rollback is automatic when
 * post-update verification fails.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type {
  UpdateCheckResult,
  UpdateOptions,
  UpdateProgress,
  UpdateProgressCallback,
  UpdateResult,
  UpdateStep,
  UpdateStepStatus,
} from "./types.js";

import { UPDATER_EXEC_TIMEOUT_MS, UPDATER_PULL_TIMEOUT_MS } from "../../config/defaults.js";

const execFileAsync = promisify(execFile);

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Check for available updates by comparing local image digest to remote.
 */
export async function checkForUpdates(options: UpdateOptions): Promise<UpdateCheckResult> {
  const { deployDir, signal } = options;
  const report = progress(options.onProgress);

  report("check", "running", "Checking for updates…");

  const image = await getImageName(deployDir);
  if (!image) {
    report("check", "failed", "Cannot determine image name from docker-compose.yml");
    return { available: false, currentImage: "unknown", error: "Cannot determine image from docker-compose.yml" };
  }

  try {
    // Get local image digest
    let localDigest: string | undefined;
    try {
      const { stdout } = await execFileAsync(
        "docker",
        ["image", "inspect", image, "--format", "{{.Id}}"],
        { timeout: UPDATER_EXEC_TIMEOUT_MS, signal },
      );
      localDigest = stdout.trim();
    } catch (e) {
      console.warn(`[updater] Failed to inspect local image digest:`, e);
    }

    // Pull to check for updates (dry-run style: pull and compare)
    await execFileAsync(
      "docker",
      ["pull", "--quiet", image],
      { timeout: UPDATER_PULL_TIMEOUT_MS, signal },
    );

    // Get new digest after pull
    const { stdout: newDigestOut } = await execFileAsync(
      "docker",
      ["image", "inspect", image, "--format", "{{.Id}}"],
      { timeout: UPDATER_EXEC_TIMEOUT_MS, signal },
    );
    const newDigest = newDigestOut.trim();

    const available = !localDigest || localDigest !== newDigest;
    const status = available ? "Update available" : "Already up to date";
    report("check", "done", status);

    return {
      available,
      currentImage: image,
      latestDigest: newDigest,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (signal?.aborted) {
      return { available: false, currentImage: image, error: "Check aborted" };
    }
    report("check", "failed", `Update check failed: ${message}`);
    return { available: false, currentImage: image, error: message };
  }
}

/**
 * Apply update: backup → pull → restart → verify → rollback on failure.
 */
export async function applyUpdate(options: UpdateOptions): Promise<UpdateResult> {
  const { deployDir, signal } = options;
  const composePath = join(deployDir, "engine", "docker-compose.yml");
  const report = progress(options.onProgress);

  // ── Step 1: Pre-update backup ─────────────────────────────────────────
  let backupId: string | undefined;

  if (options.passphrase) {
    report("backup", "running", "Creating pre-update backup…");
    try {
      const { createBackup } = await import("../backup/index.js");
      const backupResult = await createBackup({
        deployDir,
        passphrase: options.passphrase,
      });

      if (backupResult.success) {
        backupId = backupResult.snapshotId;
        report("backup", "done", `Backup created: ${backupId}`);
      } else {
        report("backup", "failed", `Backup failed: ${backupResult.error}`);
        return { success: false, error: `Pre-update backup failed: ${backupResult.error}` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report("backup", "failed", message);
      return { success: false, error: `Pre-update backup failed: ${message}` };
    }
  } else {
    report("backup", "skipped", "No passphrase — skipping pre-update backup");
  }

  if (signal?.aborted) {
    return { success: false, error: "Update aborted", backupId };
  }

  // ── Step 2: Pull latest image ─────────────────────────────────────────

  const image = await getImageName(deployDir);
  if (!image) {
    return { success: false, error: "Cannot determine image from docker-compose.yml", backupId };
  }

  report("pull", "running", `Pulling ${image}…`);
  try {
    await execFileAsync("docker", ["pull", image], {
      timeout: UPDATER_PULL_TIMEOUT_MS,
      signal,
    });
    report("pull", "done", "Image pulled");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    report("pull", "failed", `Pull failed: ${message}`);
    return { success: false, error: `Image pull failed: ${message}`, backupId };
  }

  if (signal?.aborted) {
    return { success: false, error: "Update aborted", backupId };
  }

  // ── Step 3: Restart containers ────────────────────────────────────────

  report("restart", "running", "Restarting containers…");
  try {
    await execFileAsync(
      "docker",
      ["compose", "-f", composePath, "down"],
      { timeout: UPDATER_EXEC_TIMEOUT_MS, signal },
    );
    await execFileAsync(
      "docker",
      ["compose", "-f", composePath, "up", "-d", "--wait"],
      { timeout: 120_000, signal },
    );
    report("restart", "done", "Containers restarted");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    report("restart", "failed", `Restart failed: ${message}`);

    // Attempt rollback
    return rollback(options, backupId, `Restart failed: ${message}`);
  }

  if (signal?.aborted) {
    return { success: false, error: "Update aborted", backupId };
  }

  // ── Step 4: Verify health ─────────────────────────────────────────────

  report("verify", "running", "Verifying agent health…");
  try {
    const { runDoctor } = await import("../doctor/index.js");
    const doctorReport = await runDoctor({
      deployDir,
      signal,
    });

    if (doctorReport.healthy) {
      report("verify", "done", "Agent is healthy after update");
      return { success: true, backupId };
    }

    const errorCount = doctorReport.errors.length;
    report("verify", "failed", `Doctor found ${errorCount} error(s) after update`);

    // Automatic rollback
    return rollback(options, backupId, `Post-update health check failed: ${errorCount} error(s)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    report("verify", "failed", `Health check failed: ${message}`);
    return rollback(options, backupId, `Post-update health check failed: ${message}`);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function rollback(
  options: UpdateOptions,
  backupId: string | undefined,
  reason: string,
): Promise<UpdateResult> {
  const report = progress(options.onProgress);

  if (!backupId || !options.passphrase) {
    report("rollback", "skipped", "No backup available — cannot rollback");
    return { success: false, error: `${reason}. No backup to rollback to.`, backupId };
  }

  report("rollback", "running", "Rolling back to pre-update state…");
  try {
    const { restoreBackup } = await import("../backup/index.js");
    const restoreResult = await restoreBackup({
      deployDir: options.deployDir,
      snapshot: backupId,
      passphrase: options.passphrase,
    });

    if (restoreResult.success) {
      // Restart after restore
      const composePath = join(options.deployDir, "engine", "docker-compose.yml");
      await execFileAsync(
        "docker",
        ["compose", "-f", composePath, "up", "-d", "--wait"],
        { timeout: 120_000, signal: options.signal },
      );

      report("rollback", "done", "Rolled back to pre-update state");
      return { success: false, rolledBack: true, backupId, error: reason };
    }

    report("rollback", "failed", `Rollback failed: ${restoreResult.error}`);
    return {
      success: false,
      rolledBack: false,
      backupId,
      error: `${reason}. Rollback also failed: ${restoreResult.error}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    report("rollback", "failed", `Rollback error: ${message}`);
    return {
      success: false,
      rolledBack: false,
      backupId,
      error: `${reason}. Rollback error: ${message}`,
    };
  }
}

async function getImageName(deployDir: string): Promise<string | null> {
  try {
    const composePath = join(deployDir, "engine", "docker-compose.yml");
    const raw = await readFile(composePath, "utf-8");

    // Simple extraction: find first "image:" line in the compose file
    const match = raw.match(/^\s*image:\s*["']?([^\s"']+)/m);
    return match ? match[1] : null;
  } catch (e) {
    console.warn(`[updater] Failed to read image name from compose:`, e);
    return null;
  }
}

function progress(callback?: UpdateProgressCallback) {
  return (step: UpdateStep, status: UpdateStepStatus, message: string): void => {
    if (callback) {
      const event: UpdateProgress = { step, status, message };
      callback(event);
    }
  };
}

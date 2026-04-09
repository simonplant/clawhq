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

import { UPDATER_EXEC_TIMEOUT_MS, UPDATER_PULL_TIMEOUT_MS } from "../../config/defaults.js";

import type {
  UpdateCheckResult,
  UpdateOptions,
  UpdateProgress,
  UpdateProgressCallback,
  UpdateResult,
  UpdateStep,
  UpdateStepStatus,
} from "./types.js";

const execFileAsync = promisify(execFile);

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Check for available updates.
 *
 * - source installs: git fetch + compare HEAD to origin/main
 * - cache installs: docker pull + compare image digests
 */
export async function checkForUpdates(options: UpdateOptions): Promise<UpdateCheckResult> {
  const { deployDir, signal } = options;
  const report = progress(options.onProgress);
  const installMethod = await detectInstallMethod(deployDir);

  report("check", "running", "Checking for updates…");

  if (installMethod === "source") {
    return checkForSourceUpdates(deployDir, signal, report);
  }

  return checkForCacheUpdates(deployDir, signal, report);
}

/** Check for updates in a from-source installation (git fetch + compare). */
async function checkForSourceUpdates(
  deployDir: string,
  signal: AbortSignal | undefined,
  report: ReturnType<typeof progress>,
): Promise<UpdateCheckResult> {
  const sourceDir = join(deployDir, "engine", "source");
  const image = await getImageName(deployDir) ?? "openclaw:custom";

  try {
    await execFileAsync("git", ["-C", sourceDir, "fetch", "--tags"], {
      timeout: UPDATER_PULL_TIMEOUT_MS,
      signal,
    });

    const { stdout: localHead } = await execFileAsync(
      "git", ["-C", sourceDir, "rev-parse", "HEAD"],
      { timeout: UPDATER_EXEC_TIMEOUT_MS, signal },
    );

    const { stdout: remoteHead } = await execFileAsync(
      "git", ["-C", sourceDir, "rev-parse", "origin/main"],
      { timeout: UPDATER_EXEC_TIMEOUT_MS, signal },
    );

    const { stdout: behindCount } = await execFileAsync(
      "git", ["-C", sourceDir, "rev-list", "--count", "HEAD..origin/main"],
      { timeout: UPDATER_EXEC_TIMEOUT_MS, signal },
    );

    const behind = parseInt(behindCount.trim(), 10);
    const available = behind > 0;

    // Get latest tag for display
    let latestTag = "";
    try {
      const { stdout: tagOut } = await execFileAsync(
        "git", ["-C", sourceDir, "describe", "--tags", "--abbrev=0", "origin/main"],
        { timeout: UPDATER_EXEC_TIMEOUT_MS, signal },
      );
      latestTag = tagOut.trim();
    } catch { /* no tags */ }

    const status = available
      ? `${behind} commit(s) behind${latestTag ? ` (latest: ${latestTag})` : ""}`
      : "Already up to date";
    report("check", "done", status);

    return {
      available,
      currentImage: image,
      latestDigest: remoteHead.trim(),
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

/** Check for updates in a cache installation (docker pull + digest compare). */
async function checkForCacheUpdates(
  deployDir: string,
  signal: AbortSignal | undefined,
  report: ReturnType<typeof progress>,
): Promise<UpdateCheckResult> {
  const image = await getImageName(deployDir);
  if (!image) {
    report("check", "failed", "Cannot determine image name from docker-compose.yml");
    return { available: false, currentImage: "unknown", error: "Cannot determine image from docker-compose.yml" };
  }

  try {
    let localDigest: string | undefined;
    try {
      const { stdout } = await execFileAsync(
        "docker",
        ["image", "inspect", image, "--format", "{{.Id}}"],
        { timeout: UPDATER_EXEC_TIMEOUT_MS, signal },
      );
      localDigest = stdout.trim();
    } catch {
      // Local image may not exist yet
    }

    await execFileAsync(
      "docker",
      ["pull", "--quiet", image],
      { timeout: UPDATER_PULL_TIMEOUT_MS, signal },
    );

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

  // ── Step 2: Pull source / image ────────────────────────────────────────

  const installMethod = await detectInstallMethod(deployDir);

  if (installMethod === "source") {
    // From-source: git pull + rebuild
    const sourceDir = join(deployDir, "engine", "source");

    report("pull", "running", "Pulling latest source…");
    try {
      await execFileAsync("git", ["-C", sourceDir, "pull", "--ff-only"], {
        timeout: UPDATER_PULL_TIMEOUT_MS,
        signal,
      });
      report("pull", "done", "Source updated");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report("pull", "failed", `Git pull failed: ${message}`);
      return { success: false, error: `Source pull failed: ${message}`, backupId };
    }

    if (signal?.aborted) {
      return { success: false, error: "Update aborted", backupId };
    }

    report("build", "running", "Rebuilding image from source…");
    try {
      // Shell out to `clawhq build` — it handles stage1+stage2 config resolution
      // from the deploy dir's build manifest and clawhq.yaml
      const composePath = join(deployDir, "engine", "docker-compose.yml");
      const sourceDir = join(deployDir, "engine", "source");
      await execFileAsync(
        "docker",
        ["build", "-t", await getImageName(deployDir) ?? "openclaw:custom", "-f", join(sourceDir, "Dockerfile"), sourceDir],
        { timeout: 600_000, signal },
      );
      report("build", "done", "Image rebuilt from source");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report("build", "failed", `Build failed: ${message}`);
      return { success: false, error: `Build failed: ${message}`, backupId };
    }
  } else {
    // Cache install: docker pull
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
  } catch {
    return null;
  }
}

/**
 * Detect install method from clawhq.yaml or presence of engine/source/.
 *
 * Falls back to "cache" if no config found.
 */
async function detectInstallMethod(deployDir: string): Promise<"cache" | "source"> {
  try {
    const configPath = join(deployDir, "clawhq.yaml");
    const raw = await readFile(configPath, "utf-8");
    if (raw.includes("installMethod: source") || raw.includes("installMethod: from-source")) {
      return "source";
    }
  } catch { /* no config file */ }

  // Also detect by presence of source directory
  try {
    const { stat } = await import("node:fs/promises");
    await stat(join(deployDir, "engine", "source", "package.json"));
    return "source";
  } catch { /* no source dir */ }

  return "cache";
}

function progress(callback?: UpdateProgressCallback) {
  return (step: UpdateStep, status: UpdateStepStatus, message: string): void => {
    if (callback) {
      const event: UpdateProgress = { step, status, message };
      callback(event);
    }
  };
}

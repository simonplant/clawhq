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
 * - source installs: git fetch + compare HEAD to latest release tag
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

/** Check for updates in a from-source installation (git fetch + compare to latest release tag). */
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

    const currentTag = await getCurrentTag(sourceDir, signal);
    const latestTag = await getLatestReleaseTag(sourceDir, signal);

    if (!latestTag) {
      report("check", "failed", "No release tags found in upstream");
      return { available: false, currentImage: image, error: "No release tags found" };
    }

    const { stdout: currentCommit } = await execFileAsync(
      "git", ["-C", sourceDir, "rev-parse", "HEAD"],
      { timeout: UPDATER_EXEC_TIMEOUT_MS, signal },
    );

    const { stdout: latestCommit } = await execFileAsync(
      "git", ["-C", sourceDir, "rev-parse", latestTag],
      { timeout: UPDATER_EXEC_TIMEOUT_MS, signal },
    );

    const available = currentCommit.trim() !== latestCommit.trim();

    const status = available
      ? `Update available: ${currentTag ?? currentCommit.trim().slice(0, 8)} → ${latestTag}`
      : `Already on latest release (${latestTag})`;
    report("check", "done", status);

    return {
      available,
      currentImage: image,
      latestDigest: latestCommit.trim(),
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

    report("pull", "running", "Fetching latest release…");
    try {
      await execFileAsync("git", ["-C", sourceDir, "fetch", "--tags"], {
        timeout: UPDATER_PULL_TIMEOUT_MS,
        signal,
      });

      const latestTag = await getLatestReleaseTag(sourceDir, signal);
      if (!latestTag) {
        report("pull", "failed", "No release tags found in upstream");
        return { success: false, error: "No release tags found in upstream", backupId };
      }

      await execFileAsync("git", ["-C", sourceDir, "checkout", latestTag], {
        timeout: UPDATER_EXEC_TIMEOUT_MS,
        signal,
      });
      report("pull", "done", `Checked out ${latestTag}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report("pull", "failed", `Git pull failed: ${message}`);
      return { success: false, error: `Source pull failed: ${message}`, backupId };
    }

    if (signal?.aborted) {
      return { success: false, error: "Update aborted", backupId };
    }

    // Two-stage build: base image from source, then custom image with tools
    const engineDir = join(deployDir, "engine");

    report("build", "running", "Building base image from source…");
    try {
      await execFileAsync(
        "docker",
        ["build", "-t", "openclaw:local", "-f", join(sourceDir, "Dockerfile"), sourceDir],
        { timeout: 600_000, signal },
      );
      report("build", "done", "Base image built");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report("build", "failed", `Base image build failed: ${message}`);
      return { success: false, error: `Base image build failed: ${message}`, backupId };
    }

    if (signal?.aborted) {
      return { success: false, error: "Update aborted", backupId };
    }

    report("build", "running", "Building custom image (stage 2)…");
    try {
      const customDockerfile = join(engineDir, "Dockerfile");
      const hasCustomDockerfile = (await import("node:fs")).existsSync(customDockerfile);
      if (hasCustomDockerfile) {
        await execFileAsync(
          "docker",
          ["build", "-t", await getImageName(deployDir) ?? "openclaw:custom", "-f", customDockerfile, engineDir],
          { timeout: 300_000, signal },
        );
      } else {
        // No custom Dockerfile — tag base as custom
        await execFileAsync(
          "docker",
          ["tag", "openclaw:local", await getImageName(deployDir) ?? "openclaw:custom"],
          { timeout: 30_000, signal },
        );
      }
      report("build", "done", "Custom image built");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report("build", "failed", `Custom image build failed: ${message}`);
      return { success: false, error: `Custom image build failed: ${message}`, backupId };
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

/**
 * Get the tag pointing at HEAD, if any.
 */
async function getCurrentTag(
  sourceDir: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git", ["-C", sourceDir, "describe", "--tags", "--exact-match", "HEAD"],
      { timeout: UPDATER_EXEC_TIMEOUT_MS, signal },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Find the latest release tag (vYYYY.M.D format) by version sort.
 * Ignores pre-release tags (e.g. -beta, -rc).
 */
async function getLatestReleaseTag(
  sourceDir: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git", ["-C", sourceDir, "tag", "--list", "v*", "--sort=-version:refname"],
      { timeout: UPDATER_EXEC_TIMEOUT_MS, signal },
    );
    const tags = stdout.trim().split("\n").filter(Boolean);
    // Skip pre-release tags (-beta, -rc, -alpha, etc.)
    const stable = tags.find(t => !/-/.test(t.replace(/^v/, "")));
    return stable ?? null;
  } catch {
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

/**
 * Update intelligence system — safe upstream updates with change intelligence,
 * versioned migrations, and automatic rollback.
 *
 * Pipeline: check → analyze → backup → pull/build → migrate → restart → verify → (rollback on failure)
 *
 * Never throws — returns structured result. Rollback is automatic when
 * post-update verification fails.
 */

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { getRequiredBinaries } from "../../build/docker/binary-deps.js";
import { generateStage2Dockerfile } from "../../build/docker/dockerfile.js";
import type { Stage2Config } from "../../build/docker/types.js";
import { scanWorkspaceManifest } from "../../design/configure/generate.js";
import {
  UPDATER_EXEC_TIMEOUT_MS,
  UPDATER_PULL_TIMEOUT_MS,
  UPDATER_SHUTDOWN_TIMEOUT_MS,
} from "../../config/defaults.js";

import { detectOpenClawVersion } from "../doctor/checks.js";

import {
  buildMigrationPlan,
  createMigrationContext,
  executeMigrationPlan,
  rollbackMigrations,
} from "./migrations/index.js";

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
 * Check for available updates with change intelligence.
 *
 * - source installs: git fetch + compare HEAD to latest release tag
 * - cache installs: compare local image digest to registry (no pull)
 *
 * When an update is available, enriches the result with migration plan
 * and change intelligence (deployment-specific impact analysis).
 */
export async function checkForUpdates(options: UpdateOptions): Promise<UpdateCheckResult> {
  const { deployDir, signal } = options;
  const report = progress(options.onProgress);
  const installMethod = await detectInstallMethod(deployDir);

  report("check", "running", "Checking for updates…");

  let result: UpdateCheckResult;
  if (installMethod === "source") {
    result = await checkForSourceUpdates(deployDir, options.channel, signal, report);
  } else {
    result = await checkForCacheUpdates(deployDir, signal, report);
  }

  // Enrich with change intelligence when an update is available
  if (result.available && result.currentVersion && result.targetVersion) {
    report("analyze", "running", "Analyzing update impact…");
    try {
      const { analyzeUpdate } = await import("./intelligence.js");
      const intelligence = await analyzeUpdate({
        deployDir,
        currentVersion: result.currentVersion,
        targetVersion: result.targetVersion,
        signal,
      });
      result = { ...result, intelligence };
      report("analyze", "done", `Classification: ${intelligence.classification}`);
    } catch {
      // Intelligence is best-effort — don't fail the check
      report("analyze", "skipped", "Change analysis unavailable (GitHub API unreachable)");
    }
  }

  return result;
}

/** Check for updates in a from-source installation (git fetch + compare to latest release tag). */
async function checkForSourceUpdates(
  deployDir: string,
  channel: UpdateOptions["channel"],
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
    const latestTag = await resolveTargetTag(sourceDir, channel, signal);

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

    // Detect current version from running deployment
    const currentVersion = currentTag
      ?? await detectOpenClawVersion(deployDir, signal)
      ?? undefined;

    const status = available
      ? `Update available: ${currentVersion ?? currentCommit.trim().slice(0, 8)} → ${latestTag}`
      : `Already on latest release (${latestTag})`;
    report("check", "done", status);

    return {
      available,
      currentImage: image,
      currentVersion,
      targetVersion: available ? latestTag : undefined,
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

/** Check for updates in a cache installation (registry digest compare — no pull). */
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

    // Detect current version before checking
    const currentVersion = await detectOpenClawVersion(deployDir, signal) ?? undefined;

    // BUG-18 FIX: Use `docker manifest inspect` to compare digests without pulling.
    // This avoids mutating the local image during a check-only operation.
    let remoteDigest: string | undefined;
    try {
      const { stdout } = await execFileAsync(
        "docker",
        ["manifest", "inspect", image, "--verbose"],
        { timeout: UPDATER_EXEC_TIMEOUT_MS, signal },
      );
      // Extract the config digest from manifest output
      const digestMatch = stdout.match(/"digest":\s*"(sha256:[a-f0-9]+)"/);
      remoteDigest = digestMatch ? digestMatch[1] : undefined;
    } catch {
      // manifest inspect may not be supported or image may be local-only
    }

    if (!remoteDigest) {
      // Local-only image (e.g. "openclaw:custom") — can't check remotely
      report("check", "done", "Local image — cannot check for remote updates");
      return {
        available: false,
        currentImage: image,
        currentVersion,
      };
    }

    const available = !localDigest || localDigest !== remoteDigest;

    // Extract target version from image tag (e.g. "ghcr.io/openclaw/openclaw:v2026.4.14")
    const tagMatch = image.match(/:v?(\d+\.\d+\.\d+)$/);
    const targetVersion = available && tagMatch ? `v${tagMatch[1]}` : undefined;

    const status = available ? "Update available" : "Already up to date";
    report("check", "done", status);

    return {
      available,
      currentImage: image,
      currentVersion,
      targetVersion,
      latestDigest: remoteDigest,
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
 * Apply update: backup → pull → migrate → restart → verify → rollback on failure.
 */
export async function applyUpdate(options: UpdateOptions): Promise<UpdateResult> {
  const { deployDir, signal } = options;
  const composePath = join(deployDir, "engine", "docker-compose.yml");
  const report = progress(options.onProgress);

  // Detect current version before starting
  const currentVersion = await detectOpenClawVersion(deployDir, signal) ?? undefined;

  const installMethod = await detectInstallMethod(deployDir);

  // ── BUG-4 FIX: Check if already up-to-date before doing anything ─────
  if (installMethod === "source" && !options.dryRun) {
    const sourceDir = join(deployDir, "engine", "source");
    try {
      await execFileAsync("git", ["-C", sourceDir, "fetch", "--tags"], {
        timeout: UPDATER_PULL_TIMEOUT_MS,
        signal,
      });
      const latestTag = await resolveTargetTag(sourceDir, options.channel, signal);
      if (latestTag) {
        const { stdout: currentCommit } = await execFileAsync(
          "git", ["-C", sourceDir, "rev-parse", "HEAD"],
          { timeout: UPDATER_EXEC_TIMEOUT_MS, signal },
        );
        const { stdout: latestCommit } = await execFileAsync(
          "git", ["-C", sourceDir, "rev-parse", latestTag],
          { timeout: UPDATER_EXEC_TIMEOUT_MS, signal },
        );
        if (currentCommit.trim() === latestCommit.trim()) {
          report("check", "done", `Already on latest release (${latestTag})`);
          return { success: true, migrationsApplied: 0 };
        }
      }
    } catch {
      // If check fails, proceed with update anyway
    }
  }

  // ── BUG-3 FIX: dry-run only needs version detection, not actual pull ──
  if (options.dryRun) {
    let targetVersion: string | undefined;
    if (installMethod === "source") {
      const sourceDir = join(deployDir, "engine", "source");
      try {
        await execFileAsync("git", ["-C", sourceDir, "fetch", "--tags"], {
          timeout: UPDATER_PULL_TIMEOUT_MS, signal,
        });
        targetVersion = await resolveTargetTag(sourceDir, options.channel, signal) ?? undefined;
      } catch { /* best effort */ }
    } else {
      const image = await getImageName(deployDir);
      if (image) {
        const tagMatch = image.match(/:v?(\d+\.\d+\.\d+)$/);
        if (tagMatch) targetVersion = `v${tagMatch[1]}`;
      }
    }

    if (currentVersion && targetVersion) {
      const plan = buildMigrationPlan(currentVersion, targetVersion);
      report("migrate", "done", plan.migrations.length > 0
        ? `Dry run: ${plan.migrations.length} migration(s) would be applied`
        : "Dry run: no config migrations needed");
      return { success: true, migrationsApplied: 0 };
    }
    report("migrate", "skipped", "Dry run: version detection unavailable — cannot show migration plan");
    return { success: true, migrationsApplied: 0 };
  }

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

  let targetVersion: string | undefined;

  if (installMethod === "source") {
    // From-source: git pull + rebuild
    const sourceDir = join(deployDir, "engine", "source");

    report("pull", "running", "Fetching latest release…");
    try {
      await execFileAsync("git", ["-C", sourceDir, "fetch", "--tags"], {
        timeout: UPDATER_PULL_TIMEOUT_MS,
        signal,
      });

      const latestTag = await resolveTargetTag(sourceDir, options.channel, signal);
      if (!latestTag) {
        report("pull", "failed", "No release tags found in upstream");
        return { success: false, error: "No release tags found in upstream", backupId };
      }

      targetVersion = latestTag;

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

    // BUG-15 FIX: Check abort between checkout and build
    if (signal?.aborted) {
      return { success: false, error: "Update aborted after checkout", backupId };
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

    // Regenerate Stage 2 Dockerfile so it reflects current binaries/tools.
    report("build", "running", "Building custom image (stage 2)…");
    try {
      const workspace = scanWorkspaceManifest(deployDir);
      const stage2Config: Stage2Config = {
        binaries: getRequiredBinaries(deployDir),
        workspaceTools: [],
        skills: [],
        workspace,
      };
      const customDockerfile = join(engineDir, "Dockerfile");
      await writeFile(customDockerfile, generateStage2Dockerfile("openclaw:local", stage2Config), "utf-8");

      await execFileAsync(
        "docker",
        ["build", "-t", await getImageName(deployDir) ?? "openclaw:custom", "-f", customDockerfile, engineDir],
        { timeout: 300_000, signal },
      );
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

    // Extract target version from image tag
    const tagMatch = image.match(/:v?(\d+\.\d+\.\d+)$/);
    if (tagMatch) targetVersion = `v${tagMatch[1]}`;

    // BUG-14 FIX: Skip pull for local-only image tags (e.g. "openclaw:custom").
    // These are built locally by the two-stage build and can't be pulled from a registry.
    const isLocalImage = !image.includes("/") && !image.includes(".");
    if (isLocalImage) {
      report("pull", "skipped", `Local image ${image} — skipping pull (use from-source update instead)`);
    } else {
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
  }

  if (signal?.aborted) {
    return { success: false, error: "Update aborted", backupId };
  }

  // ── Step 3: Run config migrations ────────────────────────────────────

  let migrationsApplied = 0;

  if (currentVersion && targetVersion) {
    const plan = buildMigrationPlan(currentVersion, targetVersion);

    if (plan.migrations.length > 0) {
      report("migrate", "running", `Applying ${plan.migrations.length} config migration(s)…`);
      try {
        const ctx = await createMigrationContext(deployDir, signal);
        const migrationResult = await executeMigrationPlan(plan, ctx);

        if (migrationResult.success) {
          migrationsApplied = migrationResult.applied.length;
          report("migrate", "done", `Applied ${migrationsApplied} migration(s)`);
        } else {
          report("migrate", "failed", `Migration failed: ${migrationResult.error}`);

          // Roll back applied migrations before full rollback
          await rollbackMigrations(migrationResult.applied, plan, ctx);

          return rollback(
            options,
            backupId,
            `Config migration failed: ${migrationResult.error}`,
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        report("migrate", "failed", `Migration error: ${message}`);
        return rollback(options, backupId, `Config migration error: ${message}`);
      }
    } else {
      report("migrate", "skipped", "No config migrations needed");
    }
  } else {
    report("migrate", "skipped", "Version detection unavailable — skipping migrations");
  }

  if (signal?.aborted) {
    return { success: false, error: "Update aborted", backupId };
  }

  // ── Step 4: Restart containers ────────────────────────────────────────

  report("restart", "running", "Restarting containers…");
  try {
    // BUG-12 FIX: Use longer timeout for compose down to allow graceful container stop
    await execFileAsync(
      "docker",
      ["compose", "-f", composePath, "down"],
      { timeout: UPDATER_SHUTDOWN_TIMEOUT_MS, signal },
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

  // ── Step 5: Verify health ─────────────────────────────────────────────

  report("verify", "running", "Verifying agent health…");
  try {
    const { runDoctor } = await import("../doctor/index.js");
    const doctorReport = await runDoctor({
      deployDir,
      signal,
    });

    if (!doctorReport.healthy) {
      const errorCount = doctorReport.errors.length;
      report("verify", "failed", `Doctor found ${errorCount} error(s) after update`);
      return rollback(options, backupId, `Post-update health check failed: ${errorCount} error(s)`);
    }

    // BUG-10 FIX: Also verify the gateway is responding if token/port are provided
    if (options.gatewayPort) {
      try {
        const port = options.gatewayPort;
        const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
          signal: signal ?? AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          report("verify", "failed", `Gateway health check returned HTTP ${response.status}`);
          return rollback(options, backupId, `Gateway unhealthy after update (HTTP ${response.status})`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        report("verify", "failed", `Gateway unreachable: ${message}`);
        return rollback(options, backupId, `Gateway unreachable after update: ${message}`);
      }
    }

    report("verify", "done", "Agent is healthy after update");
    return { success: true, backupId, migrationsApplied };
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
      // BUG-11 FIX: Stop any running containers before starting the restored version
      const composePath = join(options.deployDir, "engine", "docker-compose.yml");
      try {
        await execFileAsync(
          "docker",
          ["compose", "-f", composePath, "down"],
          { timeout: UPDATER_SHUTDOWN_TIMEOUT_MS, signal: options.signal },
        );
      } catch {
        // Container may already be stopped — continue with restart
      }

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

/**
 * Resolve target tag using channel policy, falling back to latest release tag.
 *
 * BUG-2 FIX: Actually wire channel resolution into the update flow.
 */
async function resolveTargetTag(
  sourceDir: string,
  channel: UpdateOptions["channel"],
  signal?: AbortSignal,
): Promise<string | null> {
  if (channel) {
    try {
      const { stdout } = await execFileAsync(
        "git", ["-C", sourceDir, "tag", "--list", "v*", "--sort=-version:refname"],
        { timeout: UPDATER_EXEC_TIMEOUT_MS, signal },
      );
      const tags = stdout.trim().split("\n").filter(Boolean);

      if (tags.length > 0) {
        const { resolveTargetVersion } = await import("./channels.js");
        const resolved = await resolveTargetVersion(tags, {
          channel,
          signal,
        });
        if (resolved) return resolved;
      }
    } catch {
      // Fall through to default
    }
  }

  // Default: latest release tag
  return getLatestReleaseTag(sourceDir, signal);
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

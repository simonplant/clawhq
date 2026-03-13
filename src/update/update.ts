/**
 * Update orchestration — safe upstream update sequence.
 *
 * Full sequence: version check -> changelog -> snapshot -> pull -> rebuild ->
 * stop -> start -> healthcheck -> firewall reapply -> doctor.
 *
 * On any failure after snapshot, rollback restores the previous image,
 * restarts, and verifies health.
 */

import { createBackup } from "../backup/backup.js";
import type { StepResult } from "../deploy/types.js";
import { twoStageBuild } from "../docker/build.js";
import { DockerClient } from "../docker/client.js";
import { runChecks } from "../doctor/runner.js";
import type { DoctorContext } from "../doctor/types.js";
import { pollGatewayHealth, HealthPollTimeout } from "../gateway/health.js";
import {
  apply as applyFirewall,
  buildConfig as buildFirewallConfig,
} from "../security/firewall/firewall.js";

import { fetchChangelog, formatChangelog } from "./changelog.js";
import { rollback } from "./rollback.js";
import type { UpdateOptions, UpdateResult } from "./types.js";
import { UpdateError } from "./types.js";
import { checkForUpdate } from "./version-check.js";

async function timedStep(
  name: string,
  fn: () => Promise<{ passed: boolean; message: string }>,
): Promise<StepResult> {
  const start = Date.now();
  try {
    const { passed, message } = await fn();
    return {
      name,
      status: passed ? "done" : "failed",
      message,
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    return {
      name,
      status: "failed",
      message: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Run the full update sequence.
 *
 * In check-only mode (--check), stops after displaying the changelog.
 * In normal mode, proceeds through the full sequence with rollback on failure.
 */
export async function runUpdate(opts: UpdateOptions = {}): Promise<UpdateResult> {
  const steps: StepResult[] = [];
  const repo = opts.repo ?? "openclaw/openclaw";
  const baseTag = opts.baseTag ?? "openclaw:local";
  const finalTag = opts.finalTag ?? "openclaw:custom";
  const context = opts.context ?? ".";
  const healthTimeoutMs = opts.healthTimeoutMs ?? 60_000;
  const gatewayHost = opts.gatewayHost ?? "127.0.0.1";
  const gatewayPort = opts.gatewayPort ?? 18789;
  const openclawHome = opts.openclawHome ?? "~/.openclaw";
  const backupDir = opts.backupDir ?? "~/.clawhq/backups";

  let currentTag = "";
  let latestTag = "";
  let snapshotId: string | undefined;

  // Step 1: Check for updates
  const versionStep = await timedStep("Version check", async () => {
    const client = new DockerClient();
    let current = "unknown";

    // Try to get current version from image label
    try {
      const info = await client.imageInspect(finalTag, { signal: opts.signal });
      const labels = (info.config as Record<string, unknown>).Labels as Record<string, string> | undefined;
      current = labels?.["org.openclaw.version"] ?? labels?.["version"] ?? "unknown";
    } catch {
      // Image may not exist yet
    }

    currentTag = current;
    const result = await checkForUpdate(current, { repo, signal: opts.signal });
    latestTag = result.latest.tag;

    if (!result.updateAvailable) {
      return { passed: true, message: `Already up to date (${current})` };
    }

    return {
      passed: true,
      message: `Update available: ${current} -> ${result.latest.tag} (${result.latest.publishedAt.split("T")[0]})`,
    };
  });
  steps.push(versionStep);

  if (versionStep.status === "failed") {
    return { success: false, steps, previousVersion: currentTag, newVersion: latestTag, rolledBack: false };
  }

  // If already up to date, nothing to do
  if (currentTag === latestTag || (!latestTag && currentTag !== "unknown")) {
    return { success: true, steps, previousVersion: currentTag, newVersion: latestTag || currentTag, rolledBack: false };
  }

  // Step 2: Fetch and display changelog
  const changelogStep = await timedStep("Changelog", async () => {
    const changelog = await fetchChangelog(currentTag, { repo, signal: opts.signal });

    if (changelog.entries.length === 0) {
      return { passed: true, message: "No changelog entries between versions" };
    }

    const summary = changelog.hasBreaking
      ? `${changelog.entries.length} release(s) with BREAKING CHANGES`
      : `${changelog.entries.length} release(s)`;

    return { passed: true, message: summary };
  });
  steps.push(changelogStep);

  // --check mode: stop here
  if (opts.checkOnly) {
    return {
      success: true,
      steps,
      previousVersion: currentTag,
      newVersion: latestTag,
      rolledBack: false,
    };
  }

  // Step 3: Pre-update snapshot
  const snapshotStep = await timedStep("Pre-update snapshot", async () => {
    if (!opts.gpgRecipient) {
      return { passed: true, message: "Skipped (no --gpg-recipient)" };
    }

    const result = await createBackup({
      openclawHome: openclawHome.replace(/^~/, process.env.HOME ?? "~"),
      backupDir: backupDir.replace(/^~/, process.env.HOME ?? "~"),
      gpgRecipient: opts.gpgRecipient,
    });

    snapshotId = result.backupId;
    return { passed: true, message: `Snapshot: ${result.backupId}` };
  });
  steps.push(snapshotStep);

  if (snapshotStep.status === "failed") {
    return { success: false, steps, previousVersion: currentTag, newVersion: latestTag, rolledBack: false, snapshotId };
  }

  // Tag the current image for rollback before rebuilding
  const client = new DockerClient();
  const rollbackTag = `${finalTag}-pre-update`;
  try {
    await client.exec(["tag", finalTag, rollbackTag], { signal: opts.signal });
  } catch {
    // If current image doesn't exist, we can't rollback to it
  }

  // Step 4: Pull latest source (git pull in context dir)
  const pullStep = await timedStep("Pull upstream", async () => {
    const { execFile: execFileCb } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFile = promisify(execFileCb);

    try {
      const { stdout } = await execFile("git", ["pull", "--ff-only"], {
        cwd: context,
        signal: opts.signal ?? undefined,
      });
      const summary = stdout.trim().split("\n").pop() ?? "Updated";
      return { passed: true, message: summary };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new UpdateError(`git pull failed: ${msg}`, "PULL_FAILED", { context });
    }
  });
  steps.push(pullStep);

  if (pullStep.status === "failed") {
    return doRollback(steps, rollbackTag, currentTag, latestTag, snapshotId, opts);
  }

  // Step 5: Rebuild images
  const buildStep = await timedStep("Rebuild", async () => {
    const result = await twoStageBuild(client, {
      context,
      baseTag,
      finalTag,
      dockerfile: opts.dockerfile,
      signal: opts.signal,
    });

    const stage1Msg = result.stage1
      ? `Stage 1: ${result.stage1.durationMs}ms, `
      : "Stage 1: skipped, ";
    return {
      passed: true,
      message: `${stage1Msg}Stage 2: ${result.stage2.durationMs}ms`,
    };
  });
  steps.push(buildStep);

  if (buildStep.status === "failed") {
    return doRollback(steps, rollbackTag, currentTag, latestTag, snapshotId, opts);
  }

  // Step 6: Stop containers
  const composeClient = opts.composePath
    ? new DockerClient({ cwd: opts.composePath.replace(/\/[^/]+$/, "") })
    : new DockerClient();

  const stopStep = await timedStep("Stop", async () => {
    await composeClient.down({ signal: opts.signal });
    return { passed: true, message: "Containers stopped" };
  });
  steps.push(stopStep);

  if (stopStep.status === "failed") {
    return doRollback(steps, rollbackTag, currentTag, latestTag, snapshotId, opts);
  }

  // Step 7: Start with new images
  const startStep = await timedStep("Start", async () => {
    await composeClient.up({ detach: true, signal: opts.signal });
    return { passed: true, message: "Containers started" };
  });
  steps.push(startStep);

  if (startStep.status === "failed") {
    return doRollback(steps, rollbackTag, currentTag, latestTag, snapshotId, opts);
  }

  // Step 8: Health check
  const healthStep = await timedStep("Health check", async () => {
    try {
      const health = await pollGatewayHealth({
        host: gatewayHost,
        port: gatewayPort,
        timeoutMs: healthTimeoutMs,
        signal: opts.signal,
      });
      return { passed: true, message: `Gateway healthy (${health.latencyMs}ms)` };
    } catch (err: unknown) {
      if (err instanceof HealthPollTimeout) {
        return { passed: false, message: `Health poll timed out after ${err.timeoutMs}ms` };
      }
      throw err;
    }
  });
  steps.push(healthStep);

  if (healthStep.status === "failed") {
    return doRollback(steps, rollbackTag, currentTag, latestTag, snapshotId, opts);
  }

  // Step 9: Reapply firewall
  const firewallStep = await timedStep("Firewall reapply", async () => {
    const fwConfig = await buildFirewallConfig({
      enabledProviders: opts.enabledProviders,
      bridgeInterface: opts.bridgeInterface,
    });
    const result = await applyFirewall(fwConfig);
    if (!result.success) {
      return { passed: false, message: `Firewall failed: ${result.message}` };
    }
    return { passed: true, message: result.message };
  });
  steps.push(firewallStep);

  // Firewall failure is not fatal — warn but continue

  // Step 10: Run doctor
  const doctorStep = await timedStep("Doctor", async () => {
    const homePath = openclawHome.replace(/^~/, process.env.HOME ?? "~");
    const ctx: DoctorContext = {
      openclawHome: homePath,
      configPath: `${homePath}/openclaw.json`,
      composePath: opts.composePath,
      envPath: opts.envPath,
      imageTag: finalTag,
      baseTag,
    };

    const report = await runChecks(ctx);
    const msg = `${report.counts.pass} passed, ${report.counts.warn} warnings, ${report.counts.fail} failed`;

    if (!report.passed) {
      return { passed: false, message: `Doctor found issues: ${msg}` };
    }
    return { passed: true, message: msg };
  });
  steps.push(doctorStep);

  // Doctor failure is a warning, not a rollback trigger
  const success = steps.every(
    (s) => s.status === "done" || s.name === "Firewall reapply" || s.name === "Doctor",
  );

  return {
    success,
    steps,
    previousVersion: currentTag,
    newVersion: latestTag,
    rolledBack: false,
    snapshotId,
  };
}

/**
 * Internal helper: trigger rollback and return an UpdateResult.
 */
async function doRollback(
  steps: StepResult[],
  rollbackTag: string,
  currentTag: string,
  latestTag: string,
  snapshotId: string | undefined,
  opts: UpdateOptions,
): Promise<UpdateResult> {
  const rollbackResult = await rollback({
    previousImageTag: rollbackTag,
    composePath: opts.composePath,
    healthTimeoutMs: opts.healthTimeoutMs,
    gatewayHost: opts.gatewayHost,
    gatewayPort: opts.gatewayPort,
    enabledProviders: opts.enabledProviders,
    bridgeInterface: opts.bridgeInterface,
    signal: opts.signal,
  });

  // Add rollback steps to the main step list
  for (const rs of rollbackResult.steps) {
    steps.push({ ...rs, name: `Rollback: ${rs.name}` });
  }

  return {
    success: false,
    steps,
    previousVersion: currentTag,
    newVersion: latestTag,
    rolledBack: true,
    snapshotId,
  };
}

/**
 * Format update result for changelog display (--check mode).
 */
export async function formatCheckResult(opts: UpdateOptions = {}): Promise<string> {
  const repo = opts.repo ?? "openclaw/openclaw";
  const finalTag = opts.finalTag ?? "openclaw:custom";
  const client = new DockerClient();

  let currentTag = "unknown";
  try {
    const info = await client.imageInspect(finalTag, { signal: opts.signal });
    const labels = (info.config as Record<string, unknown>).Labels as Record<string, string> | undefined;
    currentTag = labels?.["org.openclaw.version"] ?? labels?.["version"] ?? "unknown";
  } catch {
    // Image may not exist
  }

  const result = await checkForUpdate(currentTag, { repo, signal: opts.signal });
  if (!result.updateAvailable) {
    return `Already up to date (${currentTag})`;
  }

  const changelog = await fetchChangelog(currentTag, { repo, signal: opts.signal });
  const lines: string[] = [
    `Update available: ${currentTag} -> ${result.latest.tag}`,
    "",
    formatChangelog(changelog),
  ];

  return lines.join("\n");
}

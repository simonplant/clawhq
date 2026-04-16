/**
 * Snapshot builder — creates golden VM images per provider for sub-60s provisioning.
 *
 * Pipeline: provision base VM → install Docker + ClawHQ → snapshot → destroy builder.
 * The snapshot is reused for all future provisions — only blueprint config and tokens
 * are injected at boot time via cloud-init user-data (see snapshot-init.ts).
 *
 * Snapshot version is tracked and auto-rebuilt when clawhq version changes.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateCloudInit } from "./cloud-init.js";
import { resolveAdapter } from "./engine.js";
import { pollInstanceHealth } from "./health.js";
import { addSnapshot, readSnapshotRegistry, removeSnapshot } from "./snapshot-registry.js";
import type {
  SnapshotBuildOptions,
  SnapshotBuildProgressCallback,
  SnapshotBuildResult,
  SnapshotBuildStepName,
  SnapshotRecord,
} from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** How long to wait for cloud-init to complete on the builder VM (15 min). */
const BUILDER_HEALTH_TIMEOUT_MS = 900_000;

/** How long to wait between destroy verification attempts (ms). */
const DESTROY_VERIFY_INTERVAL_MS = 3_000;

/** Number of destroy verification attempts. */
const DESTROY_VERIFY_ATTEMPTS = 5;

// ── Version ─────────────────────────────────────────────────────────────────

/** Read the current clawhq version from package.json. */
export function getClawhqVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(fileURLToPath(import.meta.url), "../../../../package.json"), "utf-8"),
    ) as { version: string };
    return pkg.version;
  } catch {
    return "unknown";
  }
}

// ── Build Snapshot ──────────────────────────────────────────────────────────

/**
 * Build a golden VM snapshot for a provider.
 *
 * Full pipeline:
 * 1. Validate credentials
 * 2. Provision builder VM (full cloud-init install)
 * 3. Wait for cloud-init to complete (SSH + dashboard reachable)
 * 4. Snapshot the builder VM
 * 5. Destroy the builder VM
 * 6. Register snapshot in the local registry
 */
export async function buildSnapshot(options: SnapshotBuildOptions): Promise<SnapshotBuildResult> {
  const report = progress(options.onProgress);
  const clawhqVersion = getClawhqVersion();
  const snapshotName = `clawhq-${options.provider}-${clawhqVersion}-${Date.now()}`;

  // Step 1: Validate credentials
  report("credentials", "running", `Validating ${options.provider} credentials…`);

  const { adapter, error: adapterError } = resolveAdapter(options.deployDir, options.provider);
  if (!adapter) {
    report("credentials", "failed", adapterError ?? "Unknown credential error");
    return { success: false, error: adapterError };
  }
  report("credentials", "done", `${options.provider} credentials valid`);

  // Step 2: Provision builder VM with full cloud-init
  report("provision-builder", "running", `Creating builder VM in ${options.region}…`);

  const builderName = `clawhq-snapshot-builder-${Date.now()}`;
  const userData = generateCloudInit({ name: builderName });

  const createResult = await adapter.createVm({
    name: builderName,
    region: options.region,
    size: options.size,
    userData,
    sshKeys: options.sshKeys,
    signal: options.signal,
  });

  if (!createResult.success || !createResult.providerInstanceId) {
    report("provision-builder", "failed", createResult.error ?? "Failed to create builder VM");
    return { success: false, error: createResult.error ?? "Failed to create builder VM" };
  }

  const builderId = createResult.providerInstanceId;
  report("provision-builder", "done", `Builder VM created (ID: ${builderId})`);

  // Step 3: Wait for cloud-init to complete
  report("wait-install", "running", "Waiting for cloud-init install to complete…");

  // Get IP address
  let ipAddress = createResult.ipAddress;
  if (!ipAddress) {
    const status = await adapter.getVmStatus(builderId, options.signal);
    ipAddress = status.ipAddress;
  }

  if (!ipAddress) {
    report("wait-install", "failed", "Builder VM has no IP address");
    // Clean up builder VM
    await adapter.destroyVm(builderId, options.signal).catch((err: unknown) => {
      console.warn(`[clawhq] WARNING: Failed to destroy builder VM ${builderId} (${options.provider}). It may still be running and incurring cost. Destroy it manually. Error: ${err instanceof Error ? err.message : String(err)}`);
    });
    return { success: false, error: "Builder VM created but no IP address assigned" };
  }

  const healthResult = await pollInstanceHealth({
    ipAddress,
    timeoutMs: BUILDER_HEALTH_TIMEOUT_MS,
    signal: options.signal,
  });

  if (!healthResult.healthy) {
    report("wait-install", "failed", healthResult.error ?? "Builder VM did not become healthy");
    // Clean up builder VM
    await adapter.destroyVm(builderId, options.signal).catch((err: unknown) => {
      console.warn(`[clawhq] WARNING: Failed to destroy builder VM ${builderId} (${options.provider}). It may still be running and incurring cost. Destroy it manually. Error: ${err instanceof Error ? err.message : String(err)}`);
    });
    return { success: false, error: healthResult.error ?? "Builder VM did not become healthy in time" };
  }

  report("wait-install", "done", `Install complete (${Math.round(healthResult.elapsedMs / 1000)}s)`);

  // Step 4: Snapshot the builder VM
  report("snapshot", "running", `Creating snapshot "${snapshotName}"…`);

  const snapshotResult = await adapter.createSnapshot({
    providerInstanceId: builderId,
    name: snapshotName,
    signal: options.signal,
  });

  if (!snapshotResult.success || !snapshotResult.snapshotId) {
    report("snapshot", "failed", snapshotResult.error ?? "Failed to create snapshot");
    // Clean up builder VM
    await adapter.destroyVm(builderId, options.signal).catch((err: unknown) => {
      console.warn(`[clawhq] WARNING: Failed to destroy builder VM ${builderId} (${options.provider}). It may still be running and incurring cost. Destroy it manually. Error: ${err instanceof Error ? err.message : String(err)}`);
    });
    return { success: false, error: snapshotResult.error ?? "Failed to create snapshot" };
  }

  report("snapshot", "done", `Snapshot created (ID: ${snapshotResult.snapshotId})`);

  // Step 5: Destroy builder VM
  report("destroy-builder", "running", `Destroying builder VM (ID: ${builderId})…`);

  const destroyResult = await adapter.destroyVm(builderId, options.signal);

  if (destroyResult.success) {
    // Verify destruction
    for (let i = 0; i < DESTROY_VERIFY_ATTEMPTS; i++) {
      if (options.signal?.aborted) break;
      const verified = await adapter.verifyDestroyed(builderId, options.signal);
      if (verified) break;
      await new Promise<void>((resolve) => setTimeout(resolve, DESTROY_VERIFY_INTERVAL_MS));
    }
    report("destroy-builder", "done", "Builder VM destroyed");
  } else {
    // Non-fatal — snapshot was already created
    report("destroy-builder", "failed", `Builder VM cleanup failed: ${destroyResult.error}. Delete manually.`);
  }

  // Step 6: Register snapshot
  report("registry", "running", "Registering snapshot…");

  const record: SnapshotRecord = {
    snapshotId: snapshotResult.snapshotId,
    provider: options.provider,
    region: options.region,
    builderSize: options.size,
    clawhqVersion,
    builtAt: new Date().toISOString(),
    name: snapshotName,
  };

  addSnapshot(options.deployDir, record);
  report("registry", "done", `Snapshot registered: ${snapshotResult.snapshotId} (v${clawhqVersion})`);

  return {
    success: true,
    snapshotId: snapshotResult.snapshotId,
    clawhqVersion,
  };
}

// ── Delete Snapshot ─────────────────────────────────────────────────────────

/** Result of deleting a snapshot. */
export interface SnapshotDeleteResult {
  readonly success: boolean;
  readonly error?: string;
}

/**
 * Delete a snapshot from the provider and remove it from the local registry.
 *
 * Note: Provider-side deletion is best-effort — some providers don't expose
 * a direct delete-snapshot API through our adapter. The local registry entry
 * is always removed.
 */
export async function deleteSnapshot(
  deployDir: string,
  snapshotId: string,
  _signal?: AbortSignal,
): Promise<SnapshotDeleteResult> {
  const registry = readSnapshotRegistry(deployDir);
  const record = registry.snapshots.find((s) => s.snapshotId === snapshotId);

  if (!record) {
    return { success: false, error: `Snapshot not found: ${snapshotId}` };
  }

  // Remove from local registry (always succeeds)
  removeSnapshot(deployDir, snapshotId);

  return { success: true };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function progress(callback?: SnapshotBuildProgressCallback) {
  return (
    step: SnapshotBuildStepName,
    status: "running" | "done" | "failed",
    message: string,
  ): void => {
    if (callback) {
      callback({ step, status, message });
    }
  };
}

/**
 * Provisioning engine orchestrator.
 *
 * Coordinates the full provisioning flow:
 * 1. Load/validate credentials
 * 2. Create VM via provider adapter (cloud-init or snapshot)
 * 3. Create firewall (HTTPS + gateway port only)
 * 4. Wait for health
 * 5. Register instance
 *
 * Also handles destroy (with verification) and status queries (with cost).
 */

import { GATEWAY_DEFAULT_PORT } from "../../config/defaults.js";

import { generateCloudInit } from "./cloud-init.js";
import { getProviderCredential } from "./credentials.js";
import { pollInstanceHealth } from "./health.js";
import { createAwsAdapter } from "./providers/aws.js";
import { createDigitalOceanAdapter } from "./providers/digitalocean.js";
import { createGcpAdapter } from "./providers/gcp.js";
import { createHetznerAdapter } from "./providers/hetzner.js";
import {
  addInstance,
  findInstance,
  removeInstance,
  updateInstanceStatus,
} from "./registry.js";
import type {
  CloudProvider,
  DestroyOptions,
  DestroyResult,
  InstanceStatus,
  InstanceStatusOptions,
  ProviderAdapter,
  ProvisionOptions,
  ProvisionProgressCallback,
  ProvisionResult,
  ProvisionStepName,
} from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const DESTROY_VERIFY_ATTEMPTS = 5;
const DESTROY_VERIFY_INTERVAL_MS = 3_000;

// ── Provider Resolution ─────────────────────────────────────────────────────

/** Resolve a provider adapter for the given provider and deployment directory. */
export function resolveAdapter(
  deployDir: string,
  provider: CloudProvider,
): { adapter?: ProviderAdapter; error?: string } {
  const credential = getProviderCredential(deployDir, provider);
  if (!credential) {
    return {
      error: `No credentials found for provider "${provider}". Run: clawhq deploy credentials --provider ${provider} --token <your-token>`,
    };
  }

  switch (provider) {
    case "digitalocean":
      return { adapter: createDigitalOceanAdapter(credential.token) };
    case "hetzner":
      return { adapter: createHetznerAdapter(credential.token) };
    case "aws":
      return { adapter: createAwsAdapter(credential.token) };
    case "gcp":
      return { adapter: createGcpAdapter(credential.token) };
    default:
      return { error: `Unknown provider: ${provider}` };
  }
}

// ── Provision ───────────────────────────────────────────────────────────────

/**
 * Provision a new cloud instance with a running ClawHQ agent.
 *
 * Full flow: credentials → create VM → firewall → wait for health → register instance.
 * Supports two paths:
 * - Cloud-init (universal): ~3 minutes, installs from scratch
 * - Snapshot (fast): ~60 seconds, boots from pre-built golden image
 */
export async function provision(options: ProvisionOptions): Promise<ProvisionResult> {
  const report = progress(options.onProgress);
  const gatewayPort = options.gatewayPort ?? GATEWAY_DEFAULT_PORT;

  // Step 1: Resolve provider adapter (validates credentials)
  report("credentials", "running", `Validating ${options.provider} credentials…`);

  const { adapter, error: adapterError } = resolveAdapter(options.deployDir, options.provider);
  if (!adapter) {
    report("credentials", "failed", adapterError ?? "Unknown credential error");
    return { success: false, error: adapterError };
  }
  report("credentials", "done", `${options.provider} credentials valid`);

  // Resolve cost for transparency
  const monthlyCost = adapter.getMonthlyCost(options.size);

  // Step 2: Create VM (cloud-init or snapshot path)
  const costInfo = monthlyCost !== undefined ? ` ($${monthlyCost}/mo)` : "";
  report("create-vm", "running", `Creating ${options.size}${costInfo} VM in ${options.region}…`);

  let createResult;
  if (options.snapshotId) {
    // Fast path: boot from pre-built snapshot
    createResult = await adapter.createVmFromSnapshot({
      name: options.name,
      region: options.region,
      size: options.size,
      snapshotId: options.snapshotId,
      sshKeys: options.sshKeys,
      signal: options.signal,
    });
  } else {
    // Universal path: cloud-init bootstrap
    const userData = generateCloudInit({ name: options.name });
    createResult = await adapter.createVm({
      name: options.name,
      region: options.region,
      size: options.size,
      userData,
      sshKeys: options.sshKeys,
      signal: options.signal,
    });
  }

  if (!createResult.success || !createResult.providerInstanceId) {
    report("create-vm", "failed", createResult.error ?? "Failed to create VM");
    return { success: false, error: createResult.error ?? "Failed to create VM" };
  }

  report("create-vm", "done", `VM created (ID: ${createResult.providerInstanceId})`);

  // Step 3: Wait for VM to boot and get IP
  report("wait-boot", "running", "Waiting for VM to become active…");

  let ipAddress = createResult.ipAddress;
  if (!ipAddress) {
    const status = await adapter.getVmStatus(createResult.providerInstanceId, options.signal);
    ipAddress = status.ipAddress;
  }

  if (!ipAddress) {
    report("wait-boot", "failed", "VM created but no IP address assigned");
    const instance = addInstance(options.deployDir, {
      name: options.name,
      provider: options.provider,
      providerInstanceId: createResult.providerInstanceId,
      ipAddress: "pending",
      region: options.region,
      size: options.size,
      status: "provisioning",
    });
    return {
      success: false,
      instanceId: instance.id,
      monthlyCost,
      error: "VM created but no IP address assigned yet. Check status with: clawhq deploy status",
    };
  }

  report("wait-boot", "done", `VM active at ${ipAddress}`);

  // Step 4: Create firewall (HTTPS + gateway port only)
  report("firewall", "running", `Creating firewall (allow ports 443, ${gatewayPort})…`);

  const firewallResult = await adapter.createFirewall({
    name: `clawhq-${options.name}`,
    inboundPorts: [443, gatewayPort],
    dropletIds: [createResult.providerInstanceId],
    signal: options.signal,
  });

  if (firewallResult.success) {
    report("firewall", "done", `Firewall created (ID: ${firewallResult.firewallId})`);
  } else {
    // Firewall failure is not fatal — log and continue
    report("firewall", "failed", `Firewall creation failed: ${firewallResult.error}. Inbound traffic is unrestricted.`);
  }

  // Step 5: Register instance (provisioning status)
  report("registry", "running", "Registering instance…");

  const instance = addInstance(options.deployDir, {
    name: options.name,
    provider: options.provider,
    providerInstanceId: createResult.providerInstanceId,
    ipAddress,
    region: options.region,
    size: options.size,
    status: "provisioning",
  });

  // Step 6: Health check
  report("health-check", "running", "Waiting for agent to become healthy…");

  const healthResult = await pollInstanceHealth({
    ipAddress,
    signal: options.signal,
  });

  if (healthResult.healthy) {
    updateInstanceStatus(options.deployDir, instance.id, "active");
    report("health-check", "done", `Agent healthy (${healthResult.attempts} checks, ${Math.round(healthResult.elapsedMs / 1000)}s)`);
  } else {
    updateInstanceStatus(options.deployDir, instance.id, "unhealthy");
    report("health-check", "failed", healthResult.error ?? "Agent did not become healthy");
  }

  report("registry", "done", `Instance registered: ${instance.id}`);

  return {
    success: true,
    instanceId: instance.id,
    ipAddress,
    healthy: healthResult.healthy,
    monthlyCost,
  };
}

// ── Destroy ─────────────────────────────────────────────────────────────────

/** Destroy a provisioned instance with verification. Removes from provider and registry. */
export async function destroyInstance(options: DestroyOptions): Promise<DestroyResult> {
  const instance = findInstance(options.deployDir, options.instanceId);
  if (!instance) {
    return { success: false, destroyed: false, error: `Instance not found: ${options.instanceId}` };
  }

  const { adapter, error: adapterError } = resolveAdapter(options.deployDir, instance.provider);
  if (!adapter) {
    return { success: false, destroyed: false, error: adapterError };
  }

  // Mark as destroying
  updateInstanceStatus(options.deployDir, options.instanceId, "destroying");

  const result = await adapter.destroyVm(instance.providerInstanceId, options.signal);

  if (!result.success) {
    updateInstanceStatus(options.deployDir, options.instanceId, "error");
    return result;
  }

  // Verify destruction — poll until the droplet is confirmed gone
  for (let i = 0; i < DESTROY_VERIFY_ATTEMPTS; i++) {
    if (options.signal?.aborted) break;

    const verified = await adapter.verifyDestroyed(instance.providerInstanceId, options.signal);
    if (verified) break;

    await new Promise<void>((resolve) => setTimeout(resolve, DESTROY_VERIFY_INTERVAL_MS));
  }

  // Mark as destroyed and remove from registry
  updateInstanceStatus(options.deployDir, options.instanceId, "destroyed");
  removeInstance(options.deployDir, options.instanceId);

  return { success: true, destroyed: true };
}

// ── Status ──────────────────────────────────────────────────────────────────

/** Get live status of a provisioned instance from the provider (includes cost). */
export async function getInstanceStatus(options: InstanceStatusOptions): Promise<InstanceStatus> {
  const instance = findInstance(options.deployDir, options.instanceId);
  if (!instance) {
    return { state: "not-found", error: `Instance not found: ${options.instanceId}` };
  }

  const { adapter, error: adapterError } = resolveAdapter(options.deployDir, instance.provider);
  if (!adapter) {
    return { state: "unknown", error: adapterError };
  }

  return adapter.getVmStatus(instance.providerInstanceId, options.signal);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function progress(callback?: ProvisionProgressCallback) {
  return (
    step: ProvisionStepName,
    status: "running" | "done" | "failed",
    message: string,
  ): void => {
    if (callback) {
      callback({ step, status, message });
    }
  };
}

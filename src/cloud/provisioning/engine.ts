/**
 * Provisioning engine orchestrator.
 *
 * Coordinates the full provisioning flow:
 * 1. Load/validate credentials
 * 2. Create VM via provider adapter
 * 3. Wait for health
 * 4. Register instance
 *
 * Also handles destroy and status queries.
 */

import { generateCloudInit } from "./cloud-init.js";
import { getProviderCredential } from "./credentials.js";
import { pollInstanceHealth } from "./health.js";
import { createDigitalOceanAdapter } from "./providers/digitalocean.js";
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
    case "aws":
      return { error: "AWS provider is not yet implemented. Coming soon." };
    case "gcp":
      return { error: "GCP provider is not yet implemented. Coming soon." };
    default:
      return { error: `Unknown provider: ${provider}` };
  }
}

// ── Provision ───────────────────────────────────────────────────────────────

/**
 * Provision a new cloud instance with a running ClawHQ agent.
 *
 * Full flow: credentials → create VM → wait for health → register instance.
 */
export async function provision(options: ProvisionOptions): Promise<ProvisionResult> {
  const report = progress(options.onProgress);

  // Step 1: Resolve provider adapter (validates credentials)
  report("credentials", "running", `Validating ${options.provider} credentials…`);

  const { adapter, error: adapterError } = resolveAdapter(options.deployDir, options.provider);
  if (!adapter) {
    report("credentials", "failed", adapterError ?? "Unknown credential error");
    return { success: false, error: adapterError };
  }
  report("credentials", "done", `${options.provider} credentials valid`);

  // Step 2: Generate cloud-init and create VM
  report("create-vm", "running", `Creating ${options.size} VM in ${options.region}…`);

  const userData = generateCloudInit({ name: options.name });

  const createResult = await adapter.createVm({
    name: options.name,
    region: options.region,
    size: options.size,
    userData,
    sshKeys: options.sshKeys,
    signal: options.signal,
  });

  if (!createResult.success || !createResult.providerInstanceId) {
    report("create-vm", "failed", createResult.error ?? "Failed to create VM");
    return { success: false, error: createResult.error ?? "Failed to create VM" };
  }

  report("create-vm", "done", `VM created (ID: ${createResult.providerInstanceId})`);

  // Step 3: Wait for VM to boot and get IP
  report("wait-boot", "running", "Waiting for VM to become active…");

  let ipAddress = createResult.ipAddress;
  if (!ipAddress) {
    // Poll the provider for the IP
    const status = await adapter.getVmStatus(createResult.providerInstanceId, options.signal);
    ipAddress = status.ipAddress;
  }

  if (!ipAddress) {
    report("wait-boot", "failed", "VM created but no IP address assigned");
    // Still register it so the user can check status later
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
      error: "VM created but no IP address assigned yet. Check status with: clawhq deploy status",
    };
  }

  report("wait-boot", "done", `VM active at ${ipAddress}`);

  // Step 4: Register instance (provisioning status)
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

  // Step 5: Health check
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
  };
}

// ── Destroy ─────────────────────────────────────────────────────────────────

/** Destroy a provisioned instance. Removes from provider and registry. */
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

  if (result.success) {
    // Mark as destroyed and remove from registry
    updateInstanceStatus(options.deployDir, options.instanceId, "destroyed");
    removeInstance(options.deployDir, options.instanceId);
    return { success: true, destroyed: true };
  }

  // Revert status on failure
  updateInstanceStatus(options.deployDir, options.instanceId, "error");
  return result;
}

// ── Status ──────────────────────────────────────────────────────────────────

/** Get live status of a provisioned instance from the provider. */
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

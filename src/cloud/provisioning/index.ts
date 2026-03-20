/**
 * Cloud provisioning module — spin up agents on DO/AWS/GCP from CLI.
 *
 * Provider-agnostic interface with DigitalOcean as first implementation.
 * AWS and GCP adapters to follow.
 */

// Types
export type {
  CloudCredentials,
  CloudProvider,
  CreateVmOptions,
  CreateVmResult,
  DestroyOptions,
  DestroyResult,
  InstanceRegistry,
  InstanceRegistryStatus,
  InstanceStatus,
  InstanceStatusOptions,
  ProviderAdapter,
  ProviderCredential,
  ProvisionedInstance,
  ProvisionOptions,
  ProvisionProgress,
  ProvisionProgressCallback,
  ProvisionResult,
  ProvisionStepName,
} from "./types.js";

// Engine (orchestrator)
export {
  destroyInstance,
  getInstanceStatus,
  provision,
  resolveAdapter,
} from "./engine.js";

// Registry
export {
  addInstance,
  findInstance,
  findInstanceByName,
  instanceRegistryPath,
  readInstanceRegistry,
  removeInstance,
  updateInstanceStatus,
} from "./registry.js";

// Credentials
export {
  cloudCredentialsPath,
  getProviderCredential,
  readCloudCredentials,
  removeProviderCredential,
  setProviderCredential,
} from "./credentials.js";

// Cloud-init
export { generateCloudInit } from "./cloud-init.js";

// Health
export type { HealthPollOptions, HealthPollResult } from "./health.js";
export { pollInstanceHealth } from "./health.js";

// Providers
export { createDigitalOceanAdapter } from "./providers/digitalocean.js";

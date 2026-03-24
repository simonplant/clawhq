/**
 * Cloud provisioning module — spin up agents on DO/AWS/GCP from CLI.
 *
 * Provider-agnostic interface with DigitalOcean as first implementation.
 * AWS and GCP adapters to follow.
 */

// Errors
export { ProvisionError } from "./types.js";

// Types
export type {
  AddSshKeyOptions,
  AddSshKeyResult,
  CloudCredentials,
  CloudProvider,
  CreateFirewallOptions,
  CreateFirewallResult,
  CreateSnapshotOptions,
  CreateSnapshotResult,
  CreateVmFromSnapshotOptions,
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
  SnapshotBuildOptions,
  SnapshotBuildProgress,
  SnapshotBuildProgressCallback,
  SnapshotBuildResult,
  SnapshotBuildStepName,
  SnapshotRecord,
  SnapshotRegistry,
  SshKeyInfo,
  TokenValidationResult,
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
  setProviderCredentialWithValidation,
  validateProviderToken,
} from "./credentials.js";

// Cloud-init
export { generateCloudInit } from "./cloud-init.js";
export type { CloudInitOptions, CloudInitTrustMode } from "./cloud-init.js";

// Health
export type { HealthPollOptions, HealthPollResult } from "./health.js";
export { pollInstanceHealth } from "./health.js";

// Snapshot builder
export { buildSnapshot, deleteSnapshot, getClawhqVersion } from "./snapshot.js";
export type { SnapshotDeleteResult } from "./snapshot.js";

// Snapshot registry
export {
  addSnapshot,
  findLatestSnapshot,
  findSnapshot,
  isSnapshotStale,
  readSnapshotRegistry,
  removeSnapshot,
  snapshotRegistryPath,
} from "./snapshot-registry.js";

// Snapshot boot-time init
export { generateSnapshotInit } from "./snapshot-init.js";
export type { SnapshotInitOptions } from "./snapshot-init.js";

// SSH keypair generation
export { generateSshKeypair, sshKeyPath } from "./ssh-keygen.js";
export type { GeneratedKeypair } from "./ssh-keygen.js";

// Deploy wizard
export type {
  DeployWizardOptions,
  DeployWizardResult,
  DetectedSshKey,
  ProviderInfo,
  RegionInfo,
  SizeInfo,
} from "./wizard.js";
export {
  detectSshKeys,
  estimateMonthlyCost,
  executeDeploy,
  getProviderCatalog,
  getProviderInfo,
  hasStoredCredentials,
  storeAndValidateCredentials,
  uploadSshKey,
} from "./wizard.js";

// Providers
export { createAwsAdapter } from "./providers/aws.js";
export { createDigitalOceanAdapter } from "./providers/digitalocean.js";
export { createGcpAdapter } from "./providers/gcp.js";
export { createHetznerAdapter } from "./providers/hetzner.js";

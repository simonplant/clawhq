/**
 * Types for cloud provisioning — provider-agnostic interface for spinning up
 * agents on DigitalOcean, AWS, GCP from the CLI.
 *
 * ProviderAdapter is the extension point: implement it for each cloud provider.
 * ProvisionOptions drives the full flow; ProvisionResult reports the outcome.
 */

// ── Provider Identity ───────────────────────────────────────────────────────

/** Supported cloud providers. */
export type CloudProvider = "digitalocean" | "aws" | "gcp";

// ── Provision Options ───────────────────────────────────────────────────────

/** Options for provisioning a new cloud VM with a running agent. */
export interface ProvisionOptions {
  /** Cloud provider to use. */
  readonly provider: CloudProvider;
  /** Deployment directory (local ~/.clawhq for credentials + registry). */
  readonly deployDir: string;
  /** Human-readable label for the instance. */
  readonly name: string;
  /** VM region (provider-specific, e.g. "nyc3", "us-east-1"). */
  readonly region: string;
  /** VM size/type (provider-specific, e.g. "s-2vcpu-4gb", "t3.medium"). */
  readonly size: string;
  /** Optional SSH key IDs/fingerprints to add to the VM. */
  readonly sshKeys?: readonly string[];
  /** Optional abort signal for cancellation. */
  readonly signal?: AbortSignal;
  /** Progress callback. */
  readonly onProgress?: ProvisionProgressCallback;
}

/** Options for destroying a provisioned instance. */
export interface DestroyOptions {
  /** Deployment directory. */
  readonly deployDir: string;
  /** Instance ID from the registry. */
  readonly instanceId: string;
  /** Optional abort signal. */
  readonly signal?: AbortSignal;
}

/** Options for querying instance status. */
export interface InstanceStatusOptions {
  /** Deployment directory. */
  readonly deployDir: string;
  /** Instance ID from the registry. */
  readonly instanceId: string;
  /** Optional abort signal. */
  readonly signal?: AbortSignal;
}

// ── Provision Result ────────────────────────────────────────────────────────

/** Result of a provisioning operation. */
export interface ProvisionResult {
  readonly success: boolean;
  /** Instance ID (provider-specific, e.g. DO droplet ID). */
  readonly instanceId?: string;
  /** Public IPv4 address of the provisioned VM. */
  readonly ipAddress?: string;
  /** Whether the agent passed health checks after provisioning. */
  readonly healthy?: boolean;
  /** Error message on failure. */
  readonly error?: string;
}

/** Result of destroying an instance. */
export interface DestroyResult {
  readonly success: boolean;
  /** Whether the instance was found and destroyed. */
  readonly destroyed: boolean;
  readonly error?: string;
}

/** Live status of a provisioned instance. */
export interface InstanceStatus {
  /** Provider-reported VM state (e.g. "active", "running", "off"). */
  readonly state: string;
  /** Public IPv4 address. */
  readonly ipAddress?: string;
  /** Whether the agent is healthy (if reachable). */
  readonly healthy?: boolean;
  readonly error?: string;
}

// ── Provider Adapter ────────────────────────────────────────────────────────

/** Provider-agnostic adapter interface. One implementation per cloud provider. */
export interface ProviderAdapter {
  /** Provider identifier. */
  readonly provider: CloudProvider;

  /**
   * Create a VM, inject cloud-init, return the instance details.
   * Does NOT wait for health — the engine handles that.
   */
  createVm(options: CreateVmOptions): Promise<CreateVmResult>;

  /** Destroy a VM by its provider-specific ID. */
  destroyVm(providerInstanceId: string, signal?: AbortSignal): Promise<DestroyResult>;

  /** Get current status of a VM by its provider-specific ID. */
  getVmStatus(providerInstanceId: string, signal?: AbortSignal): Promise<InstanceStatus>;
}

/** Options passed to the provider adapter's createVm. */
export interface CreateVmOptions {
  /** Human-readable name for the VM. */
  readonly name: string;
  /** Region slug. */
  readonly region: string;
  /** Size/type slug. */
  readonly size: string;
  /** Cloud-init user data script. */
  readonly userData: string;
  /** SSH key identifiers (IDs or fingerprints). */
  readonly sshKeys?: readonly string[];
  /** Abort signal. */
  readonly signal?: AbortSignal;
}

/** Result of creating a VM via the provider adapter. */
export interface CreateVmResult {
  readonly success: boolean;
  /** Provider-specific instance ID (e.g. droplet ID). */
  readonly providerInstanceId?: string;
  /** Public IPv4 address (may not be available immediately). */
  readonly ipAddress?: string;
  readonly error?: string;
}

// ── Instance Registry ───────────────────────────────────────────────────────

/** A provisioned instance tracked in the registry. */
export interface ProvisionedInstance {
  /** Internal instance ID (uuid). */
  readonly id: string;
  /** Human-readable label. */
  readonly name: string;
  /** Cloud provider. */
  readonly provider: CloudProvider;
  /** Provider-specific instance ID (e.g. droplet ID). */
  readonly providerInstanceId: string;
  /** Public IPv4 address. */
  readonly ipAddress: string;
  /** VM region. */
  readonly region: string;
  /** VM size. */
  readonly size: string;
  /** Current known status. */
  readonly status: InstanceRegistryStatus;
  /** ISO 8601 timestamp of provisioning. */
  readonly createdAt: string;
  /** ISO 8601 timestamp of last status update. */
  readonly updatedAt: string;
}

/** Status of an instance in the registry. */
export type InstanceRegistryStatus = "provisioning" | "active" | "unhealthy" | "destroying" | "destroyed" | "error";

/** Persisted instance registry at ~/.clawhq/cloud/instances.json. */
export interface InstanceRegistry {
  readonly version: 1;
  readonly instances: readonly ProvisionedInstance[];
}

// ── Cloud Credentials ───────────────────────────────────────────────────────

/** Cloud provider credentials stored at ~/.clawhq/cloud/credentials.json. */
export interface CloudCredentials {
  readonly version: 1;
  readonly providers: Partial<Record<CloudProvider, ProviderCredential>>;
}

/** Credential entry for a single provider. */
export interface ProviderCredential {
  /** API token or access key. */
  readonly token: string;
  /** ISO 8601 timestamp of when the credential was stored. */
  readonly storedAt: string;
}

// ── Progress ────────────────────────────────────────────────────────────────

/** Progress events during provisioning. */
export interface ProvisionProgress {
  readonly step: ProvisionStepName;
  readonly status: "running" | "done" | "failed";
  readonly message: string;
}

/** Steps in the provisioning flow. */
export type ProvisionStepName =
  | "credentials"
  | "create-vm"
  | "wait-boot"
  | "health-check"
  | "registry";

export type ProvisionProgressCallback = (progress: ProvisionProgress) => void;

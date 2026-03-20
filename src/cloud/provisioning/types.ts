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
  /** Use a pre-built snapshot instead of cloud-init (fast path). */
  readonly snapshotId?: string;
  /** Gateway port for firewall rules (defaults to GATEWAY_DEFAULT_PORT). */
  readonly gatewayPort?: number;
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
  /** Monthly cost in USD for the selected size. */
  readonly monthlyCost?: number;
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
  /** Monthly cost in USD (if known). */
  readonly monthlyCost?: number;
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

  /** Validate the API token by making a lightweight API call. */
  validateToken(signal?: AbortSignal): Promise<TokenValidationResult>;

  /** Register an SSH public key with the provider. Returns the key ID. */
  addSshKey(options: AddSshKeyOptions): Promise<AddSshKeyResult>;

  /** List SSH keys registered with the provider. */
  listSshKeys(signal?: AbortSignal): Promise<SshKeyInfo[]>;

  /** Create a firewall restricting inbound to specified ports. */
  createFirewall(options: CreateFirewallOptions): Promise<CreateFirewallResult>;

  /** Create a snapshot from a running VM. */
  createSnapshot(options: CreateSnapshotOptions): Promise<CreateSnapshotResult>;

  /** Create a VM from a pre-built snapshot (fast path). */
  createVmFromSnapshot(options: CreateVmFromSnapshotOptions): Promise<CreateVmResult>;

  /** Verify a VM has been fully destroyed (no longer exists at provider). */
  verifyDestroyed(providerInstanceId: string, signal?: AbortSignal): Promise<boolean>;

  /** Get monthly cost for a given size slug. */
  getMonthlyCost(size: string): number | undefined;
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

// ── Token Validation ──────────────────────────────────────────────────────

/** Result of validating an API token. */
export interface TokenValidationResult {
  readonly valid: boolean;
  /** Account email or identifier (if available). */
  readonly account?: string;
  readonly error?: string;
}

// ── SSH Keys ──────────────────────────────────────────────────────────────

/** Options for adding an SSH key to a provider. */
export interface AddSshKeyOptions {
  /** Human-readable name for the key. */
  readonly name: string;
  /** Public key content (e.g. "ssh-ed25519 AAAA..."). */
  readonly publicKey: string;
  /** Abort signal. */
  readonly signal?: AbortSignal;
}

/** Result of adding an SSH key. */
export interface AddSshKeyResult {
  readonly success: boolean;
  /** Provider-specific key ID. */
  readonly keyId?: string;
  /** Key fingerprint. */
  readonly fingerprint?: string;
  readonly error?: string;
}

/** SSH key info from the provider. */
export interface SshKeyInfo {
  readonly id: string;
  readonly name: string;
  readonly fingerprint: string;
  readonly publicKey: string;
}

// ── Firewall ──────────────────────────────────────────────────────────────

/** Options for creating a firewall. */
export interface CreateFirewallOptions {
  /** Firewall name. */
  readonly name: string;
  /** Inbound ports to allow (e.g. [443, 18789]). */
  readonly inboundPorts: readonly number[];
  /** Provider instance IDs to attach the firewall to. */
  readonly dropletIds: readonly string[];
  /** Abort signal. */
  readonly signal?: AbortSignal;
}

/** Result of creating a firewall. */
export interface CreateFirewallResult {
  readonly success: boolean;
  /** Provider-specific firewall ID. */
  readonly firewallId?: string;
  readonly error?: string;
}

// ── Snapshots ─────────────────────────────────────────────────────────────

/** Options for creating a snapshot from a running VM. */
export interface CreateSnapshotOptions {
  /** Provider instance ID of the source VM. */
  readonly providerInstanceId: string;
  /** Snapshot name. */
  readonly name: string;
  /** Abort signal. */
  readonly signal?: AbortSignal;
}

/** Result of creating a snapshot. */
export interface CreateSnapshotResult {
  readonly success: boolean;
  /** Provider-specific snapshot ID. */
  readonly snapshotId?: string;
  readonly error?: string;
}

/** Options for creating a VM from a snapshot. */
export interface CreateVmFromSnapshotOptions {
  /** Human-readable name for the VM. */
  readonly name: string;
  /** Region slug. */
  readonly region: string;
  /** Size/type slug. */
  readonly size: string;
  /** Provider-specific snapshot ID to use as the image. */
  readonly snapshotId: string;
  /** SSH key identifiers (IDs or fingerprints). */
  readonly sshKeys?: readonly string[];
  /** Abort signal. */
  readonly signal?: AbortSignal;
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
  | "firewall"
  | "health-check"
  | "registry";

export type ProvisionProgressCallback = (progress: ProvisionProgress) => void;

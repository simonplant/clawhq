/**
 * Interactive deploy wizard — walks the user from zero to a running cloud agent.
 *
 * Flow: provider → credentials → region → size → name → SSH key → cost confirm → provision.
 * Non-interactive mode: all parameters passed via DeployWizardOptions.
 *
 * Post-deploy: auto-configure trust mode (zero-trust default), send initial heartbeat.
 * Mid-flight failures auto-clean (handled by the provisioning engine).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { getProviderCredential, setProviderCredentialWithValidation } from "./credentials.js";
import { provision, resolveAdapter } from "./engine.js";
import { findLatestSnapshot, isSnapshotStale } from "./snapshot-registry.js";
import { getClawhqVersion } from "./snapshot.js";
import type {
  CloudProvider,
  ProvisionProgressCallback,
  ProvisionResult,
} from "./types.js";

// ── Provider catalog ────────────────────────────────────────────────────────

export interface ProviderInfo {
  readonly name: string;
  readonly value: CloudProvider;
  readonly regions: readonly RegionInfo[];
  readonly sizes: readonly SizeInfo[];
  readonly defaultRegion: string;
  readonly defaultSize: string;
}

export interface RegionInfo {
  readonly slug: string;
  readonly label: string;
}

export interface SizeInfo {
  readonly slug: string;
  readonly label: string;
  readonly monthlyCost: number;
}

const PROVIDER_CATALOG: readonly ProviderInfo[] = [
  {
    name: "DigitalOcean",
    value: "digitalocean",
    defaultRegion: "nyc3",
    defaultSize: "s-2vcpu-4gb",
    regions: [
      { slug: "nyc1", label: "New York 1" },
      { slug: "nyc3", label: "New York 3" },
      { slug: "sfo3", label: "San Francisco 3" },
      { slug: "ams3", label: "Amsterdam 3" },
      { slug: "sgp1", label: "Singapore 1" },
      { slug: "lon1", label: "London 1" },
      { slug: "fra1", label: "Frankfurt 1" },
      { slug: "tor1", label: "Toronto 1" },
      { slug: "blr1", label: "Bangalore 1" },
      { slug: "syd1", label: "Sydney 1" },
    ],
    sizes: [
      { slug: "s-1vcpu-1gb", label: "1 vCPU / 1 GB", monthlyCost: 6 },
      { slug: "s-1vcpu-2gb", label: "1 vCPU / 2 GB", monthlyCost: 12 },
      { slug: "s-2vcpu-2gb", label: "2 vCPU / 2 GB", monthlyCost: 18 },
      { slug: "s-2vcpu-4gb", label: "2 vCPU / 4 GB (recommended)", monthlyCost: 24 },
      { slug: "s-4vcpu-8gb", label: "4 vCPU / 8 GB", monthlyCost: 48 },
      { slug: "s-8vcpu-16gb", label: "8 vCPU / 16 GB", monthlyCost: 96 },
    ],
  },
  {
    name: "Hetzner",
    value: "hetzner",
    defaultRegion: "fsn1",
    defaultSize: "cx32",
    regions: [
      { slug: "fsn1", label: "Falkenstein (EU)" },
      { slug: "nbg1", label: "Nuremberg (EU)" },
      { slug: "hel1", label: "Helsinki (EU)" },
      { slug: "ash", label: "Ashburn (US)" },
      { slug: "hil", label: "Hillsboro (US)" },
    ],
    sizes: [
      { slug: "cx22", label: "2 vCPU / 4 GB", monthlyCost: 4.51 },
      { slug: "cx32", label: "4 vCPU / 8 GB (recommended)", monthlyCost: 8.49 },
      { slug: "cx42", label: "8 vCPU / 16 GB", monthlyCost: 15.90 },
      { slug: "cx52", label: "16 vCPU / 32 GB", monthlyCost: 29.90 },
    ],
  },
  {
    name: "AWS",
    value: "aws",
    defaultRegion: "us-east-1",
    defaultSize: "t3.medium",
    regions: [
      { slug: "us-east-1", label: "US East (N. Virginia)" },
      { slug: "us-west-2", label: "US West (Oregon)" },
      { slug: "eu-west-1", label: "EU (Ireland)" },
      { slug: "eu-central-1", label: "EU (Frankfurt)" },
      { slug: "ap-southeast-1", label: "Asia Pacific (Singapore)" },
      { slug: "ap-northeast-1", label: "Asia Pacific (Tokyo)" },
    ],
    sizes: [
      { slug: "t3.micro", label: "2 vCPU / 1 GB", monthlyCost: 7.59 },
      { slug: "t3.small", label: "2 vCPU / 2 GB", monthlyCost: 15.18 },
      { slug: "t3.medium", label: "2 vCPU / 4 GB (recommended)", monthlyCost: 30.37 },
      { slug: "t3.large", label: "2 vCPU / 8 GB", monthlyCost: 60.74 },
    ],
  },
  {
    name: "GCP",
    value: "gcp",
    defaultRegion: "us-central1-a",
    defaultSize: "e2-medium",
    regions: [
      { slug: "us-central1-a", label: "Iowa (US)" },
      { slug: "us-east1-b", label: "South Carolina (US)" },
      { slug: "europe-west1-b", label: "Belgium (EU)" },
      { slug: "europe-west3-a", label: "Frankfurt (EU)" },
      { slug: "asia-east1-a", label: "Taiwan" },
      { slug: "asia-southeast1-a", label: "Singapore" },
    ],
    sizes: [
      { slug: "e2-micro", label: "2 vCPU / 1 GB", monthlyCost: 6.11 },
      { slug: "e2-small", label: "2 vCPU / 2 GB", monthlyCost: 12.23 },
      { slug: "e2-medium", label: "2 vCPU / 4 GB (recommended)", monthlyCost: 24.46 },
      { slug: "e2-standard-2", label: "2 vCPU / 8 GB", monthlyCost: 48.92 },
    ],
  },
];

/** Get the provider catalog for the wizard UI. */
export function getProviderCatalog(): readonly ProviderInfo[] {
  return PROVIDER_CATALOG;
}

/** Look up provider info by CloudProvider value. */
export function getProviderInfo(provider: CloudProvider): ProviderInfo | undefined {
  return PROVIDER_CATALOG.find((p) => p.value === provider);
}

// ── SSH key detection ────────────────────────────────────────────────────────

export interface DetectedSshKey {
  readonly path: string;
  readonly publicKey: string;
  readonly type: string;
}

/** Detect existing SSH public keys in ~/.ssh/. */
export function detectSshKeys(): DetectedSshKey[] {
  const sshDir = join(homedir(), ".ssh");
  const keyFiles: Array<{ name: string; type: string }> = [
    { name: "id_ed25519.pub", type: "ed25519" },
    { name: "id_rsa.pub", type: "rsa" },
    { name: "id_ecdsa.pub", type: "ecdsa" },
  ];

  const found: DetectedSshKey[] = [];
  for (const { name, type } of keyFiles) {
    const fullPath = join(sshDir, name);
    if (existsSync(fullPath)) {
      try {
        const publicKey = readFileSync(fullPath, "utf-8").trim();
        if (publicKey) {
          found.push({ path: fullPath, publicKey, type });
        }
      } catch {
        // Ignore unreadable keys
      }
    }
  }
  return found;
}

// ── Wizard options and result ────────────────────────────────────────────────

export interface DeployWizardOptions {
  /** Cloud provider. */
  readonly provider: CloudProvider;
  /** Deployment directory (local ~/.clawhq). */
  readonly deployDir: string;
  /** Instance name. */
  readonly name: string;
  /** VM region. */
  readonly region: string;
  /** VM size. */
  readonly size: string;
  /** SSH key IDs/fingerprints for the VM. */
  readonly sshKeys?: readonly string[];
  /** Explicit snapshot ID to use (skips auto-detection). */
  readonly snapshotId?: string;
  /** Auto-detect and use a pre-built snapshot if available. */
  readonly useSnapshot?: boolean;
  /** Optional abort signal. */
  readonly signal?: AbortSignal;
  /** Progress callback. */
  readonly onProgress?: ProvisionProgressCallback;
}

export interface DeployWizardResult {
  /** Provision result from the engine. */
  readonly provision: ProvisionResult;
  /** Whether trust mode was configured. */
  readonly trustModeConfigured: boolean;
  /** Whether heartbeat was sent. */
  readonly heartbeatSent: boolean;
  /** Monthly cost in USD. */
  readonly monthlyCost?: number;
}

// ── Wizard execution ────────────────────────────────────────────────────────

/**
 * Execute the deploy wizard with resolved options.
 *
 * This is the core orchestrator — it takes fully resolved options
 * (from interactive prompts or CLI flags) and runs the provisioning
 * flow with post-deploy configuration.
 */
export async function executeDeploy(options: DeployWizardOptions): Promise<DeployWizardResult> {
  // Resolve snapshot: explicit ID takes precedence, then auto-detect
  let snapshotId: string | undefined = options.snapshotId;
  if (!snapshotId && options.useSnapshot !== false) {
    const snapshot = findLatestSnapshot(options.deployDir, options.provider, options.region);
    if (snapshot && !isSnapshotStale(snapshot, getClawhqVersion())) {
      snapshotId = snapshot.snapshotId;
    }
  }

  // Run provisioning
  const provisionResult = await provision({
    provider: options.provider,
    deployDir: options.deployDir,
    name: options.name,
    region: options.region,
    size: options.size,
    sshKeys: options.sshKeys ? [...options.sshKeys] : undefined,
    snapshotId,
    signal: options.signal,
    onProgress: options.onProgress,
  });

  if (!provisionResult.success) {
    return {
      provision: provisionResult,
      trustModeConfigured: false,
      heartbeatSent: false,
      monthlyCost: provisionResult.monthlyCost,
    };
  }

  // Post-deploy: configure trust mode (zero-trust default)
  let trustModeConfigured = false;
  try {
    const { switchTrustMode } = await import("../trust-modes/index.js");
    switchTrustMode(options.deployDir, "zero-trust");
    trustModeConfigured = true;
  } catch {
    // Non-fatal — trust mode config failure doesn't invalidate the deployment
  }

  // Post-deploy: send initial heartbeat
  let heartbeatSent = false;
  try {
    const { sendHeartbeat } = await import("../heartbeat/reporter.js");
    const heartbeatResult = await sendHeartbeat(options.deployDir, "zero-trust");
    heartbeatSent = heartbeatResult.success;
  } catch {
    // Non-fatal — heartbeat failure doesn't invalidate the deployment
  }

  return {
    provision: provisionResult,
    trustModeConfigured,
    heartbeatSent,
    monthlyCost: provisionResult.monthlyCost,
  };
}

// ── Cost estimation ──────────────────────────────────────────────────────────

/**
 * Get the estimated monthly cost for a provider/size combination.
 * Returns undefined if the size is not in the catalog.
 */
export function estimateMonthlyCost(provider: CloudProvider, size: string): number | undefined {
  const info = getProviderInfo(provider);
  if (!info) return undefined;
  const sizeInfo = info.sizes.find((s) => s.slug === size);
  return sizeInfo?.monthlyCost;
}

/**
 * Check if valid credentials exist for a provider.
 * Does not validate against the provider API — just checks local storage.
 */
export function hasStoredCredentials(deployDir: string, provider: CloudProvider): boolean {
  return getProviderCredential(deployDir, provider) !== undefined;
}

/**
 * Store and validate credentials for a provider.
 * Returns validation result.
 */
export async function storeAndValidateCredentials(
  deployDir: string,
  provider: CloudProvider,
  token: string,
  signal?: AbortSignal,
): Promise<{ valid: boolean; account?: string; error?: string }> {
  return setProviderCredentialWithValidation(deployDir, provider, token, signal);
}

/**
 * Upload an SSH public key to the provider. Returns the key ID.
 */
export async function uploadSshKey(
  deployDir: string,
  provider: CloudProvider,
  name: string,
  publicKey: string,
  signal?: AbortSignal,
): Promise<{ success: boolean; keyId?: string; error?: string }> {
  const { adapter, error } = resolveAdapter(deployDir, provider);
  if (!adapter) {
    return { success: false, error };
  }
  const result = await adapter.addSshKey({ name, publicKey, signal });
  return { success: result.success, keyId: result.keyId, error: result.error };
}

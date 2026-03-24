/**
 * GCP Compute Engine provider adapter — full GCE API for VM lifecycle.
 *
 * Implements the ProviderAdapter interface for Google Cloud Compute Engine.
 * Uses native fetch (Node 22+). No SDK dependency.
 *
 * Two credential modes:
 * - "PROJECT_ID:ACCESS_TOKEN" — for gcloud CLI users
 *   (get token via `gcloud auth print-access-token`)
 * - Service account JSON key string — parsed automatically, derives
 *   OAuth2 access tokens via JWT grant
 *
 * Default machine type: e2-micro (free tier eligible).
 *
 * Reference: https://cloud.google.com/compute/docs/reference/rest/v1
 */

import { createSign } from "node:crypto";

import type {
  AddSshKeyOptions,
  AddSshKeyResult,
  CreateFirewallOptions,
  CreateFirewallResult,
  CreateSnapshotOptions,
  CreateSnapshotResult,
  CreateVmFromSnapshotOptions,
  CreateVmOptions,
  CreateVmResult,
  DestroyResult,
  InstanceStatus,
  ProviderAdapter,
  SshKeyInfo,
  TokenValidationResult,
} from "../types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const GCP_COMPUTE_BASE = "https://compute.googleapis.com/compute/v1";
const GCP_TOKEN_URL = "https://oauth2.googleapis.com/token";
const COMPUTE_SCOPE = "https://www.googleapis.com/auth/compute";

const DEFAULT_MACHINE_TYPE = "e2-micro";
const DEFAULT_IMAGE_PROJECT = "ubuntu-os-cloud";
const DEFAULT_IMAGE_FAMILY = "ubuntu-2404-lts-amd64";
const API_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 300_000;
const OP_POLL_TIMEOUT_MS = 600_000;

/** GCE machine type monthly costs (approximate, us-central1 on-demand). */
const SIZE_MONTHLY_COST: Record<string, number> = {
  "e2-micro": 6.11,
  "e2-small": 12.23,
  "e2-medium": 24.46,
  "e2-standard-2": 48.92,
};

// ── Service Account JWT Auth ─────────────────────────────────────────────────

interface ServiceAccountKey {
  readonly project_id: string;
  readonly client_email: string;
  readonly private_key: string;
}

function createJwt(sa: ServiceAccountKey): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      scope: COMPUTE_SCOPE,
      aud: GCP_TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  ).toString("base64url");

  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const signature = signer.sign(sa.private_key, "base64url");
  return `${unsigned}.${signature}`;
}

async function exchangeJwtForAccessToken(jwt: string): Promise<{ token: string; expiresAt: number } | { error: string }> {
  let response: Response;
  try {
    response = await fetch(GCP_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch (err) {
    return { error: `Token exchange failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "unknown error");
    return { error: `Token exchange error ${response.status}: ${text}` };
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  return { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 - 60_000 };
}

// ── Adapter ─────────────────────────────────────────────────────────────────

/**
 * Create a GCP Compute Engine provider adapter.
 *
 * Token format:
 * - "PROJECT_ID:ACCESS_TOKEN" — direct access token from gcloud CLI
 * - Service account JSON key string — auto-detected, derives OAuth2 tokens
 *
 * Zone is derived from region by appending "-a" (e.g. "us-central1" → "us-central1-a").
 */
export function createGcpAdapter(token: string, region = "us-central1"): ProviderAdapter {
  let projectId: string;
  let serviceAccount: ServiceAccountKey | undefined;
  let accessToken: string;
  let tokenExpiresAt = 0;

  // Reject empty/whitespace-only tokens immediately
  if (!token || !token.trim()) {
    throw new Error("Invalid GCP service account JSON: token must not be empty");
  }

  // Detect credential format
  if (token.trimStart().startsWith("{")) {
    // Service account JSON key
    let parsed: ServiceAccountKey;
    try {
      parsed = JSON.parse(token) as ServiceAccountKey;
    } catch (err) {
      throw new Error(`Invalid GCP service account JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    projectId = parsed.project_id;
    serviceAccount = parsed;
    accessToken = ""; // derived on first request
  } else {
    // PROJECT_ID:ACCESS_TOKEN format
    const colonIdx = token.indexOf(":");
    if (colonIdx === -1) {
      // Bare token — projectId must be resolved from API
      projectId = "";
      accessToken = token;
    } else {
      projectId = token.slice(0, colonIdx);
      accessToken = token.slice(colonIdx + 1);
    }
  }

  // Derive zone from region
  const zone = region.includes("-") && /^[a-z]+-[a-z]+\d+$/.test(region)
    ? `${region}-a`
    : region; // already a zone like "us-central1-a"

  async function getAccessToken(): Promise<string> {
    if (serviceAccount) {
      if (accessToken && Date.now() < tokenExpiresAt) return accessToken;
      const jwt = createJwt(serviceAccount);
      const result = await exchangeJwtForAccessToken(jwt);
      if ("error" in result) throw new Error(result.error);
      accessToken = result.token;
      tokenExpiresAt = result.expiresAt;
      return accessToken;
    }
    return accessToken;
  }

  async function gcpRequest(
    path: string,
    options: { method: string; body?: unknown; signal?: AbortSignal },
  ): Promise<{ ok: boolean; status: number; data?: unknown; error?: string }> {
    let tok: string;
    try {
      tok = await getAccessToken();
    } catch (err) {
      return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
    }

    const url = `${GCP_COMPUTE_BASE}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method,
        headers: {
          "Authorization": `Bearer ${tok}`,
          "Content-Type": "application/json",
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: options.signal ?? AbortSignal.timeout(API_TIMEOUT_MS),
      });
    } catch (err) {
      return { ok: false, status: 0, error: `GCP API request failed: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (response.status === 204) return { ok: true, status: 204 };

    if (!response.ok) {
      const text = await response.text().catch(() => "unknown error");
      return { ok: false, status: response.status, error: `GCP API error ${response.status}: ${text}` };
    }

    const data = await response.json();
    return { ok: true, status: response.status, data };
  }

  /** Wait for a zone operation to complete. */
  async function waitForOperation(operationName: string, signal?: AbortSignal): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < OP_POLL_TIMEOUT_MS) {
      if (signal?.aborted) return false;
      const result = await gcpRequest(
        `/projects/${projectId}/zones/${zone}/operations/${operationName}`,
        { method: "GET", signal },
      );
      if (result.ok) {
        const op = result.data as { status: string };
        if (op.status === "DONE") return true;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    return false;
  }

  /** Wait for a global operation to complete. */
  async function waitForGlobalOperation(operationName: string, signal?: AbortSignal): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < OP_POLL_TIMEOUT_MS) {
      if (signal?.aborted) return false;
      const result = await gcpRequest(
        `/projects/${projectId}/global/operations/${operationName}`,
        { method: "GET", signal },
      );
      if (result.ok) {
        const op = result.data as { status: string };
        if (op.status === "DONE") return true;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    return false;
  }

  async function pollForRunningInstance(instanceName: string, signal?: AbortSignal): Promise<string | undefined> {
    const start = Date.now();
    while (Date.now() - start < POLL_TIMEOUT_MS) {
      if (signal?.aborted) return undefined;
      const result = await gcpRequest(
        `/projects/${projectId}/zones/${zone}/instances/${instanceName}`,
        { method: "GET", signal },
      );
      if (result.ok) {
        const instance = result.data as {
          status: string;
          networkInterfaces?: { accessConfigs?: { natIP?: string }[] }[];
        };
        const ip = instance.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP;
        if (instance.status === "RUNNING" && ip) return ip;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    return undefined;
  }

  return {
    provider: "gcp",

    async validateToken(signal?: AbortSignal): Promise<TokenValidationResult> {
      if (!accessToken && !serviceAccount) {
        return { valid: false, error: "Token must be PROJECT_ID:ACCESS_TOKEN or a service account JSON key" };
      }

      // Resolve projectId if needed (bare access token)
      if (!projectId) {
        return { valid: false, error: "Token must include project ID. Use format PROJECT_ID:ACCESS_TOKEN" };
      }

      const result = await gcpRequest(`/projects/${projectId}/zones/${zone}/instances?maxResults=1`, {
        method: "GET",
        signal,
      });
      if (!result.ok) return { valid: false, error: result.error };
      return { valid: true, account: projectId };
    },

    async createVm(options: CreateVmOptions): Promise<CreateVmResult> {
      const machineType = `zones/${zone}/machineTypes/${options.size || DEFAULT_MACHINE_TYPE}`;
      const sourceImage = `projects/${DEFAULT_IMAGE_PROJECT}/global/images/family/${DEFAULT_IMAGE_FAMILY}`;

      const body = {
        name: options.name,
        machineType,
        disks: [
          {
            boot: true,
            autoDelete: true,
            initializeParams: {
              sourceImage,
              diskSizeGb: "20",
            },
          },
        ],
        networkInterfaces: [
          {
            network: `projects/${projectId}/global/networks/default`,
            accessConfigs: [
              {
                name: "External NAT",
                type: "ONE_TO_ONE_NAT",
                networkTier: "STANDARD",
              },
            ],
          },
        ],
        metadata: {
          items: [
            { key: "startup-script", value: options.userData },
          ],
        },
        tags: {
          items: ["clawhq"],
        },
        labels: {
          managed_by: "clawhq",
        },
      };

      if (options.sshKeys?.length) {
        body.metadata.items.push({
          key: "ssh-keys",
          value: options.sshKeys.join("\n"),
        });
      }

      const result = await gcpRequest(
        `/projects/${projectId}/zones/${zone}/instances`,
        { method: "POST", body, signal: options.signal },
      );
      if (!result.ok) return { success: false, error: result.error };

      // GCE returns an operation — wait for it, then poll for the instance
      const op = result.data as { name: string };
      await waitForOperation(op.name, options.signal);

      const ip = await pollForRunningInstance(options.name, options.signal);
      return { success: true, providerInstanceId: options.name, ipAddress: ip };
    },

    async destroyVm(providerInstanceId: string, signal?: AbortSignal): Promise<DestroyResult> {
      const result = await gcpRequest(
        `/projects/${projectId}/zones/${zone}/instances/${providerInstanceId}`,
        { method: "DELETE", signal },
      );
      if (!result.ok) return { success: false, destroyed: false, error: result.error };

      const op = result.data as { name: string };
      await waitForOperation(op.name, signal);
      return { success: true, destroyed: true };
    },

    async getVmStatus(providerInstanceId: string, signal?: AbortSignal): Promise<InstanceStatus> {
      const result = await gcpRequest(
        `/projects/${projectId}/zones/${zone}/instances/${providerInstanceId}`,
        { method: "GET", signal },
      );
      if (!result.ok) return { state: "unknown", error: result.error };

      const instance = result.data as {
        status: string;
        machineType?: string;
        networkInterfaces?: { accessConfigs?: { natIP?: string }[] }[];
      };
      const ip = instance.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP;

      // Extract machine type name from full URL
      const machineTypeName = instance.machineType?.split("/").pop();
      return {
        state: instance.status.toLowerCase(),
        ipAddress: ip,
        monthlyCost: SIZE_MONTHLY_COST[machineTypeName ?? ""],
      };
    },

    async addSshKey(options: AddSshKeyOptions): Promise<AddSshKeyResult> {
      // GCP manages SSH keys via project metadata
      const getResult = await gcpRequest(`/projects/${projectId}`, { method: "GET", signal: options.signal });
      if (!getResult.ok) return { success: false, error: getResult.error };

      const project = getResult.data as {
        commonInstanceMetadata?: { items?: { key: string; value: string }[]; fingerprint?: string };
      };
      const existing = project.commonInstanceMetadata?.items ?? [];
      const fingerprint = project.commonInstanceMetadata?.fingerprint ?? "";

      // Find existing ssh-keys entry or create new
      const sshKeysEntry = existing.find((i) => i.key === "ssh-keys");
      const currentKeys = sshKeysEntry?.value ?? "";
      const newEntry = `${options.name}:${options.publicKey}`;
      const updatedKeys = currentKeys ? `${currentKeys}\n${newEntry}` : newEntry;

      const items = existing.filter((i) => i.key !== "ssh-keys");
      items.push({ key: "ssh-keys", value: updatedKeys });

      const setResult = await gcpRequest(`/projects/${projectId}/setCommonInstanceMetadata`, {
        method: "POST",
        body: { items, fingerprint },
        signal: options.signal,
      });
      if (!setResult.ok) return { success: false, error: setResult.error };

      return { success: true, keyId: options.name };
    },

    async listSshKeys(signal?: AbortSignal): Promise<SshKeyInfo[]> {
      const result = await gcpRequest(`/projects/${projectId}`, { method: "GET", signal });
      if (!result.ok) return [];

      const project = result.data as {
        commonInstanceMetadata?: { items?: { key: string; value: string }[] };
      };
      const sshKeysEntry = project.commonInstanceMetadata?.items?.find((i) => i.key === "ssh-keys");
      if (!sshKeysEntry?.value) return [];

      return sshKeysEntry.value.split("\n").filter(Boolean).map((line, i) => {
        const colonIdx = line.indexOf(":");
        const name = colonIdx > 0 ? line.slice(0, colonIdx) : `key-${i}`;
        const publicKey = colonIdx > 0 ? line.slice(colonIdx + 1) : line;
        return { id: name, name, fingerprint: "", publicKey };
      });
    },

    async createFirewall(options: CreateFirewallOptions): Promise<CreateFirewallResult> {
      const allowed = options.inboundPorts.map((port) => ({
        IPProtocol: "tcp",
        ports: [String(port)],
      }));

      const body = {
        name: options.name,
        network: `projects/${projectId}/global/networks/default`,
        direction: "INGRESS",
        priority: 1000,
        targetTags: ["clawhq"],
        sourceRanges: ["0.0.0.0/0"],
        allowed,
      };

      const result = await gcpRequest(
        `/projects/${projectId}/global/firewalls`,
        { method: "POST", body, signal: options.signal },
      );
      if (!result.ok) return { success: false, error: result.error };

      const op = result.data as { name: string };
      await waitForGlobalOperation(op.name, options.signal);
      return { success: true, firewallId: options.name };
    },

    async createSnapshot(options: CreateSnapshotOptions): Promise<CreateSnapshotResult> {
      // Create machine image from instance
      const body = {
        name: options.name,
        sourceInstance: `projects/${projectId}/zones/${zone}/instances/${options.providerInstanceId}`,
      };

      const result = await gcpRequest(
        `/projects/${projectId}/global/machineImages`,
        { method: "POST", body, signal: options.signal },
      );
      if (!result.ok) return { success: false, error: result.error };

      const op = result.data as { name: string };
      await waitForGlobalOperation(op.name, options.signal);
      return { success: true, snapshotId: options.name };
    },

    async createVmFromSnapshot(options: CreateVmFromSnapshotOptions): Promise<CreateVmResult> {
      const machineType = `zones/${zone}/machineTypes/${options.size || DEFAULT_MACHINE_TYPE}`;

      const body = {
        name: options.name,
        machineType,
        sourceMachineImage: `projects/${projectId}/global/machineImages/${options.snapshotId}`,
        networkInterfaces: [
          {
            network: `projects/${projectId}/global/networks/default`,
            accessConfigs: [
              {
                name: "External NAT",
                type: "ONE_TO_ONE_NAT",
                networkTier: "STANDARD",
              },
            ],
          },
        ],
        tags: {
          items: ["clawhq"],
        },
        labels: {
          managed_by: "clawhq",
        },
      };

      const metadataItems: { key: string; value: string }[] = [];
      if (options.sshKeys?.length) {
        metadataItems.push({ key: "ssh-keys", value: options.sshKeys.join("\n") });
      }
      if (options.userData) {
        metadataItems.push({ key: "startup-script", value: options.userData });
      }
      if (metadataItems.length > 0) {
        (body as Record<string, unknown>).metadata = { items: metadataItems };
      }

      const result = await gcpRequest(
        `/projects/${projectId}/zones/${zone}/instances`,
        { method: "POST", body, signal: options.signal },
      );
      if (!result.ok) return { success: false, error: result.error };

      const op = result.data as { name: string };
      await waitForOperation(op.name, options.signal);

      const ip = await pollForRunningInstance(options.name, options.signal);
      return { success: true, providerInstanceId: options.name, ipAddress: ip };
    },

    async verifyDestroyed(providerInstanceId: string, signal?: AbortSignal): Promise<boolean> {
      const result = await gcpRequest(
        `/projects/${projectId}/zones/${zone}/instances/${providerInstanceId}`,
        { method: "GET", signal },
      );
      return !result.ok && result.status === 404;
    },

    getMonthlyCost(size: string): number | undefined {
      return SIZE_MONTHLY_COST[size];
    },
  };
}

/**
 * DigitalOcean provider adapter — full DO API v2 for droplet lifecycle.
 *
 * Supports:
 * - Droplet create/destroy/status with cloud-init or snapshot
 * - SSH key registration and listing
 * - Firewall group creation (inbound port restriction)
 * - Snapshot creation from running droplets
 * - Destroy verification (confirm droplet no longer exists)
 * - Token validation and cost transparency
 *
 * Uses native fetch (Node 22+). No SDK dependency.
 * Reference: https://docs.digitalocean.com/reference/api/api-reference/
 */

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

const DO_API_BASE = "https://api.digitalocean.com/v2";
const DEFAULT_IMAGE = "ubuntu-24-04-x64";
const API_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 300_000;
const SNAPSHOT_POLL_TIMEOUT_MS = 600_000;

/**
 * DO droplet sizes and their monthly costs.
 * Source: https://docs.digitalocean.com/products/droplets/details/pricing/
 */
const SIZE_MONTHLY_COST: Record<string, number> = {
  "s-1vcpu-512mb-10gb": 4,
  "s-1vcpu-1gb": 6,
  "s-1vcpu-2gb": 12,
  "s-2vcpu-2gb": 18,
  "s-2vcpu-4gb": 24,
  "s-4vcpu-8gb": 48,
  "s-8vcpu-16gb": 96,
};

// ── Adapter ─────────────────────────────────────────────────────────────────

/** Create a DigitalOcean provider adapter with the given API token. */
export function createDigitalOceanAdapter(token: string): ProviderAdapter {
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  /** Make a DO API request with standard error handling. */
  async function doRequest(
    path: string,
    options: {
      method: string;
      body?: unknown;
      signal?: AbortSignal;
    },
  ): Promise<{ ok: boolean; status: number; data?: unknown; error?: string }> {
    const url = `${DO_API_BASE}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: options.signal ?? AbortSignal.timeout(API_TIMEOUT_MS),
      });
    } catch (err) {
      return {
        ok: false,
        status: 0,
        error: `DO API request failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (response.status === 204) {
      return { ok: true, status: 204 };
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "unknown error");
      return { ok: false, status: response.status, error: `DigitalOcean API error ${response.status}: ${text}` };
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      const text = await response.text().catch(() => "");
      return {
        ok: false,
        status: response.status,
        error: `DigitalOcean API returned non-JSON response (HTTP ${response.status}): ${text.slice(0, 200) || "(empty body)"}`,
      };
    }
    return { ok: true, status: response.status, data };
  }

  return {
    provider: "digitalocean",

    // ── Token Validation ──────────────────────────────────────────────────

    async validateToken(signal?: AbortSignal): Promise<TokenValidationResult> {
      const result = await doRequest("/account", { method: "GET", signal });
      if (!result.ok) {
        return { valid: false, error: result.error };
      }
      const account = result.data as { account?: { email?: string } };
      return { valid: true, account: account.account?.email };
    },

    // ── Droplet Lifecycle ─────────────────────────────────────────────────

    async createVm(options: CreateVmOptions): Promise<CreateVmResult> {
      const body = {
        name: options.name,
        region: options.region,
        size: options.size,
        image: DEFAULT_IMAGE,
        user_data: options.userData,
        ssh_keys: options.sshKeys ? [...options.sshKeys] : [],
        backups: false,
        ipv6: false,
        monitoring: true,
        tags: ["clawhq"],
      };

      const result = await doRequest("/droplets", {
        method: "POST",
        body,
        signal: options.signal,
      });

      if (!result.ok) {
        return { success: false, error: result.error };
      }

      const data = result.data as { droplet: { id: number; networks?: DropletNetworks } };
      const dropletId = String(data.droplet.id);

      const ip = await pollForActiveDroplet(dropletId, headers, options.signal);

      return {
        success: true,
        providerInstanceId: dropletId,
        ipAddress: ip,
      };
    },

    async createVmFromSnapshot(options: CreateVmFromSnapshotOptions): Promise<CreateVmResult> {
      // DO API expects numeric snapshot IDs as integers
      const imageId = /^\d+$/.test(options.snapshotId)
        ? Number(options.snapshotId)
        : options.snapshotId;

      const body: Record<string, unknown> = {
        name: options.name,
        region: options.region,
        size: options.size,
        image: imageId,
        ssh_keys: options.sshKeys ? [...options.sshKeys] : [],
        backups: false,
        ipv6: false,
        monitoring: true,
        tags: ["clawhq"],
      };
      if (options.userData) body.user_data = options.userData;

      const result = await doRequest("/droplets", {
        method: "POST",
        body,
        signal: options.signal,
      });

      if (!result.ok) {
        return { success: false, error: result.error };
      }

      const data = result.data as { droplet: { id: number; networks?: DropletNetworks } };
      const dropletId = String(data.droplet.id);

      const ip = await pollForActiveDroplet(dropletId, headers, options.signal);

      return {
        success: true,
        providerInstanceId: dropletId,
        ipAddress: ip,
      };
    },

    async destroyVm(providerInstanceId: string, signal?: AbortSignal): Promise<DestroyResult> {
      const result = await doRequest(`/droplets/${providerInstanceId}`, {
        method: "DELETE",
        signal,
      });

      if (result.status === 404) {
        return { success: true, destroyed: false };
      }

      if (!result.ok) {
        return { success: false, destroyed: false, error: result.error };
      }

      return { success: true, destroyed: true };
    },

    async getVmStatus(providerInstanceId: string, signal?: AbortSignal): Promise<InstanceStatus> {
      const result = await doRequest(`/droplets/${providerInstanceId}`, {
        method: "GET",
        signal,
      });

      if (result.status === 404) {
        return { state: "not-found" };
      }

      if (!result.ok) {
        return { state: "unknown", error: result.error };
      }

      const data = result.data as { droplet: { status: string; size_slug: string; networks?: DropletNetworks } };
      const ip = extractPublicIpV4(data.droplet.networks);
      const monthlyCost = SIZE_MONTHLY_COST[data.droplet.size_slug];

      return {
        state: data.droplet.status,
        ipAddress: ip,
        monthlyCost,
      };
    },

    async verifyDestroyed(providerInstanceId: string, signal?: AbortSignal): Promise<boolean> {
      const result = await doRequest(`/droplets/${providerInstanceId}`, {
        method: "GET",
        signal,
      });
      return result.status === 404;
    },

    // ── SSH Keys ──────────────────────────────────────────────────────────

    async addSshKey(options: AddSshKeyOptions): Promise<AddSshKeyResult> {
      const result = await doRequest("/account/keys", {
        method: "POST",
        body: { name: options.name, public_key: options.publicKey },
        signal: options.signal,
      });

      if (!result.ok) {
        return { success: false, error: result.error };
      }

      const data = result.data as { ssh_key: { id: number; fingerprint: string } };
      return {
        success: true,
        keyId: String(data.ssh_key.id),
        fingerprint: data.ssh_key.fingerprint,
      };
    },

    async listSshKeys(signal?: AbortSignal): Promise<SshKeyInfo[]> {
      const result = await doRequest("/account/keys?per_page=200", {
        method: "GET",
        signal,
      });

      if (!result.ok) return [];

      const data = result.data as {
        ssh_keys: Array<{ id: number; name: string; fingerprint: string; public_key: string }>;
      };

      return data.ssh_keys.map((k) => ({
        id: String(k.id),
        name: k.name,
        fingerprint: k.fingerprint,
        publicKey: k.public_key,
      }));
    },

    // ── Firewall ──────────────────────────────────────────────────────────

    async createFirewall(options: CreateFirewallOptions): Promise<CreateFirewallResult> {
      const inboundRules = options.inboundPorts.map((port) => ({
        protocol: "tcp",
        ports: String(port),
        sources: { addresses: ["0.0.0.0/0", "::/0"] },
      }));

      // Always allow ICMP for health checks
      inboundRules.push({
        protocol: "icmp",
        ports: "0",
        sources: { addresses: ["0.0.0.0/0", "::/0"] },
      });

      const body = {
        name: options.name,
        inbound_rules: inboundRules,
        outbound_rules: [
          // Allow all outbound (egress is managed by ClawHQ's iptables chain)
          { protocol: "tcp", ports: "all", destinations: { addresses: ["0.0.0.0/0", "::/0"] } },
          { protocol: "udp", ports: "all", destinations: { addresses: ["0.0.0.0/0", "::/0"] } },
          { protocol: "icmp", ports: "0", destinations: { addresses: ["0.0.0.0/0", "::/0"] } },
        ],
        droplet_ids: options.dropletIds.map(Number),
        tags: [],
      };

      const result = await doRequest("/firewalls", {
        method: "POST",
        body,
        signal: options.signal,
      });

      if (!result.ok) {
        return { success: false, error: result.error };
      }

      const data = result.data as { firewall: { id: string } };
      return { success: true, firewallId: data.firewall.id };
    },

    // ── Snapshots ─────────────────────────────────────────────────────────

    async createSnapshot(options: CreateSnapshotOptions): Promise<CreateSnapshotResult> {
      // Trigger snapshot via droplet action
      const result = await doRequest(`/droplets/${options.providerInstanceId}/actions`, {
        method: "POST",
        body: { type: "snapshot", name: options.name },
        signal: options.signal,
      });

      if (!result.ok) {
        return { success: false, error: result.error };
      }

      const data = result.data as { action: { id: number } };
      const actionId = data.action.id;

      // Poll for action completion
      const completed = await pollForAction(
        options.providerInstanceId,
        actionId,
        headers,
        SNAPSHOT_POLL_TIMEOUT_MS,
        options.signal,
      );

      if (!completed) {
        return { success: false, error: "Snapshot action timed out" };
      }

      // Find the snapshot by name in the droplet's snapshots
      const snapshotsResult = await doRequest(
        `/droplets/${options.providerInstanceId}/snapshots?per_page=100`,
        { method: "GET", signal: options.signal },
      );

      if (!snapshotsResult.ok) {
        return { success: false, error: `Snapshot created but could not retrieve ID: ${snapshotsResult.error}` };
      }

      const snapshots = snapshotsResult.data as {
        snapshots: Array<{ id: number; name: string }>;
      };

      const snapshot = snapshots.snapshots.find((s) => s.name === options.name);
      if (!snapshot) {
        return { success: false, error: "Snapshot created but not found in listing" };
      }

      return { success: true, snapshotId: String(snapshot.id) };
    },

    // ── Cost ──────────────────────────────────────────────────────────────

    getMonthlyCost(size: string): number | undefined {
      return SIZE_MONTHLY_COST[size];
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface DropletNetworks {
  v4?: Array<{ ip_address: string; type: string }>;
}

function extractPublicIpV4(networks?: DropletNetworks): string | undefined {
  return networks?.v4?.find((n) => n.type === "public")?.ip_address;
}

/**
 * Poll the DO API until the droplet reaches "active" status with a public IP.
 * Returns the IP address, or undefined if polling times out.
 */
async function pollForActiveDroplet(
  dropletId: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const start = Date.now();

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    if (signal?.aborted) return undefined;

    await sleep(POLL_INTERVAL_MS, signal);

    try {
      const response = await fetch(`${DO_API_BASE}/droplets/${dropletId}`, {
        method: "GET",
        headers,
        signal: signal ?? AbortSignal.timeout(API_TIMEOUT_MS),
      });

      if (!response.ok) continue;

      const data = (await response.json()) as { droplet: { status: string; networks?: DropletNetworks } };

      if (data.droplet.status === "active") {
        const ip = extractPublicIpV4(data.droplet.networks);
        if (ip) return ip;
      }
    } catch {
      // Retry on network errors
    }
  }

  return undefined;
}

/**
 * Poll a droplet action until it completes or times out.
 */
async function pollForAction(
  dropletId: string,
  actionId: number,
  headers: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted) return false;

    await sleep(POLL_INTERVAL_MS, signal);

    try {
      const response = await fetch(
        `${DO_API_BASE}/droplets/${dropletId}/actions/${actionId}`,
        {
          method: "GET",
          headers,
          signal: signal ?? AbortSignal.timeout(API_TIMEOUT_MS),
        },
      );

      if (!response.ok) continue;

      const data = (await response.json()) as { action: { status: string } };

      if (data.action.status === "completed") return true;
      if (data.action.status === "errored") return false;
    } catch {
      // Retry on network errors
    }
  }

  return false;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

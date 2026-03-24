/**
 * Hetzner Cloud provider adapter — full Hetzner API for server lifecycle.
 *
 * EU-sovereign hosting path for the Privacy Migrant persona.
 * Same ProviderAdapter interface as DigitalOcean. Uses CX series servers.
 *
 * Uses native fetch (Node 22+). No SDK dependency.
 * Reference: https://docs.hetzner.cloud/
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

const HETZNER_API_BASE = "https://api.hetzner.cloud/v1";
const DEFAULT_IMAGE = "ubuntu-24.04";
const API_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 300_000;

/** Hetzner CX shared-vCPU server monthly costs (EUR, Falkenstein). */
const SIZE_MONTHLY_COST: Record<string, number> = {
  cx22: 4.51,
  cx32: 8.49,
  cx42: 15.90,
  cx52: 29.90,
};

// ── Adapter ─────────────────────────────────────────────────────────────────

/** Create a Hetzner Cloud provider adapter with the given API token. */
export function createHetznerAdapter(token: string): ProviderAdapter {
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  async function hetznerRequest(
    path: string,
    options: { method: string; body?: unknown; signal?: AbortSignal },
  ): Promise<{ ok: boolean; status: number; data?: unknown; error?: string }> {
    const url = `${HETZNER_API_BASE}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: options.signal ?? AbortSignal.timeout(API_TIMEOUT_MS),
      });
    } catch (err) {
      return { ok: false, status: 0, error: `Hetzner API request failed: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (response.status === 204) return { ok: true, status: 204 };

    if (!response.ok) {
      const text = await response.text().catch(() => "unknown error");
      return { ok: false, status: response.status, error: `Hetzner API error ${response.status}: ${text}` };
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      const text = await response.text().catch(() => "");
      return {
        ok: false,
        status: response.status,
        error: `Hetzner API returned non-JSON response (HTTP ${response.status}): ${text.slice(0, 200) || "(empty body)"}`,
      };
    }
    return { ok: true, status: response.status, data };
  }

  async function pollForRunningServer(serverId: string, signal?: AbortSignal): Promise<string | undefined> {
    const start = Date.now();
    while (Date.now() - start < POLL_TIMEOUT_MS) {
      if (signal?.aborted) return undefined;
      const result = await hetznerRequest(`/servers/${serverId}`, { method: "GET", signal });
      if (result.ok) {
        const server = (result.data as { server: { status: string; public_net?: { ipv4?: { ip?: string } } } }).server;
        if (server.status === "running" && server.public_net?.ipv4?.ip) {
          return server.public_net.ipv4.ip;
        }
      }
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    return undefined;
  }

  return {
    provider: "hetzner",

    async validateToken(signal?: AbortSignal): Promise<TokenValidationResult> {
      const result = await hetznerRequest("/servers?per_page=1", { method: "GET", signal });
      if (!result.ok) return { valid: false, error: result.error };
      return { valid: true };
    },

    async createVm(options: CreateVmOptions): Promise<CreateVmResult> {
      const body = {
        name: options.name,
        server_type: options.size,
        image: DEFAULT_IMAGE,
        location: options.region,
        user_data: options.userData,
        ssh_keys: options.sshKeys ? [...options.sshKeys] : [],
        start_after_create: true,
        labels: { managed_by: "clawhq" },
      };

      const result = await hetznerRequest("/servers", { method: "POST", body, signal: options.signal });
      if (!result.ok) return { success: false, error: result.error };

      const data = result.data as { server: { id: number; public_net?: { ipv4?: { ip?: string } } } };
      const serverId = String(data.server.id);
      const ip = data.server.public_net?.ipv4?.ip ?? await pollForRunningServer(serverId, options.signal);

      return { success: true, providerInstanceId: serverId, ipAddress: ip };
    },

    async destroyVm(providerInstanceId: string, signal?: AbortSignal): Promise<DestroyResult> {
      const result = await hetznerRequest(`/servers/${providerInstanceId}`, { method: "DELETE", signal });
      if (!result.ok) return { success: false, destroyed: false, error: result.error };
      return { success: true, destroyed: true };
    },

    async getVmStatus(providerInstanceId: string, signal?: AbortSignal): Promise<InstanceStatus> {
      const result = await hetznerRequest(`/servers/${providerInstanceId}`, { method: "GET", signal });
      if (!result.ok) return { state: "unknown", error: result.error };

      const server = (result.data as { server: { status: string; server_type?: { name?: string }; public_net?: { ipv4?: { ip?: string } } } }).server;
      return {
        state: server.status,
        ipAddress: server.public_net?.ipv4?.ip,
        monthlyCost: SIZE_MONTHLY_COST[server.server_type?.name ?? ""],
      };
    },

    async addSshKey(options: AddSshKeyOptions): Promise<AddSshKeyResult> {
      const result = await hetznerRequest("/ssh_keys", {
        method: "POST",
        body: { name: options.name, public_key: options.publicKey },
        signal: options.signal,
      });
      if (!result.ok) return { success: false, error: result.error };
      const data = result.data as { ssh_key: { id: number; fingerprint: string } };
      return { success: true, keyId: String(data.ssh_key.id), fingerprint: data.ssh_key.fingerprint };
    },

    async listSshKeys(signal?: AbortSignal): Promise<SshKeyInfo[]> {
      const result = await hetznerRequest("/ssh_keys", { method: "GET", signal });
      if (!result.ok) return [];
      const data = result.data as { ssh_keys: { id: number; name: string; fingerprint: string; public_key: string }[] };
      return data.ssh_keys.map((k) => ({ id: String(k.id), name: k.name, fingerprint: k.fingerprint, publicKey: k.public_key }));
    },

    async createFirewall(options: CreateFirewallOptions): Promise<CreateFirewallResult> {
      const rules = options.inboundPorts.map((port) => ({
        direction: "in",
        protocol: "tcp",
        port: String(port),
        source_ips: ["0.0.0.0/0", "::/0"],
      }));

      const result = await hetznerRequest("/firewalls", {
        method: "POST",
        body: {
          name: options.name,
          rules,
          apply_to: options.dropletIds.map((id) => {
            const numId = parseInt(id, 10);
            if (isNaN(numId)) {
              throw new Error(`Invalid droplet ID: '${id}' is not a numeric server ID`);
            }
            return { type: "server", server: { id: numId } };
          }),
        },
        signal: options.signal,
      });
      if (!result.ok) return { success: false, error: result.error };
      const data = result.data as { firewall: { id: number } };
      return { success: true, firewallId: String(data.firewall.id) };
    },

    async createSnapshot(options: CreateSnapshotOptions): Promise<CreateSnapshotResult> {
      const result = await hetznerRequest(`/servers/${options.providerInstanceId}/actions/create_image`, {
        method: "POST",
        body: { description: options.name, type: "snapshot" },
        signal: options.signal,
      });
      if (!result.ok) return { success: false, error: result.error };
      const data = result.data as { image: { id: number } };
      return { success: true, snapshotId: String(data.image.id) };
    },

    async createVmFromSnapshot(options: CreateVmFromSnapshotOptions): Promise<CreateVmResult> {
      const body: Record<string, unknown> = {
        name: options.name,
        server_type: options.size,
        image: options.snapshotId,
        location: options.region,
        ssh_keys: options.sshKeys ? [...options.sshKeys] : [],
        start_after_create: true,
        labels: { managed_by: "clawhq" },
      };
      if (options.userData) body.user_data = options.userData;

      const result = await hetznerRequest("/servers", { method: "POST", body, signal: options.signal });
      if (!result.ok) return { success: false, error: result.error };

      const data = result.data as { server: { id: number; public_net?: { ipv4?: { ip?: string } } } };
      const serverId = String(data.server.id);
      const ip = data.server.public_net?.ipv4?.ip ?? await pollForRunningServer(serverId, options.signal);

      return { success: true, providerInstanceId: serverId, ipAddress: ip };
    },

    async verifyDestroyed(providerInstanceId: string, signal?: AbortSignal): Promise<boolean> {
      const result = await hetznerRequest(`/servers/${providerInstanceId}`, { method: "GET", signal });
      return !result.ok && result.status === 404;
    },

    getMonthlyCost(size: string): number | undefined {
      return SIZE_MONTHLY_COST[size];
    },
  };
}

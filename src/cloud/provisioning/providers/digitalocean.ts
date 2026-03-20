/**
 * DigitalOcean provider adapter — creates/destroys/queries droplets via DO API v2.
 *
 * Uses native fetch (Node 22+). No SDK dependency.
 * Reference: https://docs.digitalocean.com/reference/api/api-reference/
 */

import type {
  CreateVmOptions,
  CreateVmResult,
  DestroyResult,
  InstanceStatus,
  ProviderAdapter,
} from "../types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const DO_API_BASE = "https://api.digitalocean.com/v2";
const DEFAULT_IMAGE = "ubuntu-24-04-x64";
const CREATE_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 300_000;

// ── Adapter ─────────────────────────────────────────────────────────────────

/** Create a DigitalOcean provider adapter with the given API token. */
export function createDigitalOceanAdapter(token: string): ProviderAdapter {
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  return {
    provider: "digitalocean",

    async createVm(options: CreateVmOptions): Promise<CreateVmResult> {
      const body = {
        name: options.name,
        region: options.region,
        size: options.size,
        image: DEFAULT_IMAGE,
        user_data: options.userData,
        ssh_keys: options.sshKeys ?? [],
        backups: false,
        ipv6: false,
        monitoring: true,
        tags: ["clawhq"],
      };

      let response: Response;
      try {
        response = await fetch(`${DO_API_BASE}/droplets`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: options.signal ?? AbortSignal.timeout(CREATE_TIMEOUT_MS),
        });
      } catch (err) {
        return {
          success: false,
          error: `Failed to create droplet: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "unknown error");
        return {
          success: false,
          error: `DigitalOcean API error ${response.status}: ${text}`,
        };
      }

      const data = (await response.json()) as { droplet: { id: number; networks?: DropletNetworks } };
      const dropletId = String(data.droplet.id);

      // Poll for active status and IP address
      const ip = await pollForActiveDroplet(dropletId, headers, options.signal);

      if (!ip) {
        return {
          success: true,
          providerInstanceId: dropletId,
          // IP not yet available — caller should poll
        };
      }

      return {
        success: true,
        providerInstanceId: dropletId,
        ipAddress: ip,
      };
    },

    async destroyVm(providerInstanceId: string, signal?: AbortSignal): Promise<DestroyResult> {
      let response: Response;
      try {
        response = await fetch(`${DO_API_BASE}/droplets/${providerInstanceId}`, {
          method: "DELETE",
          headers,
          signal: signal ?? AbortSignal.timeout(CREATE_TIMEOUT_MS),
        });
      } catch (err) {
        return {
          success: false,
          destroyed: false,
          error: `Failed to destroy droplet: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      if (response.status === 404) {
        return { success: true, destroyed: false };
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "unknown error");
        return {
          success: false,
          destroyed: false,
          error: `DigitalOcean API error ${response.status}: ${text}`,
        };
      }

      // 204 No Content = success
      return { success: true, destroyed: true };
    },

    async getVmStatus(providerInstanceId: string, signal?: AbortSignal): Promise<InstanceStatus> {
      let response: Response;
      try {
        response = await fetch(`${DO_API_BASE}/droplets/${providerInstanceId}`, {
          method: "GET",
          headers,
          signal: signal ?? AbortSignal.timeout(CREATE_TIMEOUT_MS),
        });
      } catch (err) {
        return {
          state: "unknown",
          error: `Failed to query droplet: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      if (response.status === 404) {
        return { state: "not-found" };
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "unknown error");
        return {
          state: "unknown",
          error: `DigitalOcean API error ${response.status}: ${text}`,
        };
      }

      const data = (await response.json()) as { droplet: { status: string; networks?: DropletNetworks } };
      const ip = extractPublicIpV4(data.droplet.networks);

      return {
        state: data.droplet.status,
        ipAddress: ip,
      };
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
        signal: signal ?? AbortSignal.timeout(CREATE_TIMEOUT_MS),
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

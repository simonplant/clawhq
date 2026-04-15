/**
 * Connection awareness — snapshot active gateway connections before update.
 *
 * For blue-green deploys, this is informational (old container stays up).
 * For restart-in-place, warns about active connections that will be interrupted.
 */

import { GATEWAY_DEFAULT_PORT, GATEWAY_RPC_TIMEOUT_MS } from "../../config/defaults.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ConnectionSnapshot {
  readonly timestamp: string;
  /** Active channel types (e.g. ["telegram", "signal"]). */
  readonly activeChannels: readonly string[];
  /** Whether the gateway was reachable. */
  readonly gatewayReachable: boolean;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Snapshot active gateway connections before shutdown.
 *
 * Best-effort — returns empty snapshot if gateway is unreachable.
 */
export async function snapshotConnections(options: {
  readonly deployDir: string;
  readonly gatewayPort?: number;
  readonly signal?: AbortSignal;
}): Promise<ConnectionSnapshot> {
  const port = options.gatewayPort ?? GATEWAY_DEFAULT_PORT;
  const timestamp = new Date().toISOString();

  try {
    const url = `http://127.0.0.1:${port}/healthz`;
    const response = await fetch(url, {
      signal: options.signal ?? AbortSignal.timeout(GATEWAY_RPC_TIMEOUT_MS),
    });

    if (!response.ok) {
      return { timestamp, activeChannels: [], gatewayReachable: false };
    }

    // The health endpoint returns channel status. Parse what we can.
    const data = (await response.json()) as {
      channels?: Record<string, { connected?: boolean }>;
    };

    const activeChannels = data.channels
      ? Object.entries(data.channels)
        .filter(([, v]) => v.connected)
        .map(([k]) => k)
      : [];

    return { timestamp, activeChannels, gatewayReachable: true };
  } catch {
    return { timestamp, activeChannels: [], gatewayReachable: false };
  }
}

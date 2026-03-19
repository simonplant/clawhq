/**
 * Types for the OpenClaw Gateway WebSocket RPC client.
 *
 * The Gateway exposes a JSON-RPC-style protocol over WebSocket at :18789.
 * All requests are authenticated via token. Config writes are rate-limited
 * to 3 req/60s.
 */

// ── RPC Wire Protocol ────────────────────────────────────────────────────────

/** Outbound RPC request sent over WebSocket. */
export interface RpcRequest {
  readonly id: string;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

/** Inbound RPC response received from Gateway. */
export interface RpcResponse {
  readonly id: string;
  readonly result?: unknown;
  readonly error?: RpcErrorPayload;
}

/** Error payload within an RPC response. */
export interface RpcErrorPayload {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

// ── Client Options ───────────────────────────────────────────────────────────

/** Options for creating a GatewayClient. */
export interface GatewayClientOptions {
  /** Gateway host (default: "127.0.0.1"). */
  readonly host?: string;
  /** Gateway port (default: 18789). */
  readonly port?: number;
  /** Authentication token. */
  readonly token: string;
  /** Default RPC timeout in ms (default: 10000). */
  readonly timeoutMs?: number;
}

// ── Health Polling ───────────────────────────────────────────────────────────

/** Gateway health state. */
export type HealthState = "up" | "down" | "unknown";

/** Options for the health poller. */
export interface HealthPollOptions {
  /** Polling interval in ms (default: 30000). */
  readonly intervalMs?: number;
  /** Timeout per health check in ms (default: 5000). */
  readonly timeoutMs?: number;
  /** AbortSignal to stop polling. */
  readonly signal?: AbortSignal;
}

/** Callback invoked when health state changes. */
export type HealthChangeCallback = (
  state: HealthState,
  previous: HealthState,
) => void;

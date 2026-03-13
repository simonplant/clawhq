/**
 * Gateway health check polling against :18789/healthz.
 *
 * Gateway must be healthy before further operations (deploy, config writes, etc.).
 * Uses HTTP GET — the healthz endpoint is a standard REST endpoint, not WebSocket.
 */

// --- Types ---

export type GatewayHealthStatus = "up" | "down" | "degraded";

export interface HealthCheckResult {
  status: GatewayHealthStatus;
  latencyMs: number;
  statusCode?: number;
  error?: string;
}

export interface HealthPollOptions {
  /** Gateway host (default: "127.0.0.1"). */
  host?: string;
  /** Gateway port (default: 18789). */
  port?: number;
  /** Total timeout in ms (default: 60000). */
  timeoutMs?: number;
  /** Interval between checks in ms (default: 2000). */
  intervalMs?: number;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

export class HealthPollTimeout extends Error {
  constructor(
    public readonly lastStatus: GatewayHealthStatus,
    public readonly timeoutMs: number,
  ) {
    super(
      `Gateway health poll timed out after ${timeoutMs}ms (last status: ${lastStatus})`,
    );
    this.name = "HealthPollTimeout";
  }
}

// --- Single health check ---

/**
 * Perform a single health check against the Gateway healthz endpoint.
 */
export async function checkHealth(options: {
  host?: string;
  port?: number;
  signal?: AbortSignal;
} = {}): Promise<HealthCheckResult> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 18789;
  const url = `http://${host}:${port}/healthz`;
  const start = Date.now();

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: options.signal,
    });

    const latencyMs = Date.now() - start;
    const status = response.ok ? "up" : "degraded";

    return {
      status,
      latencyMs,
      statusCode: response.status,
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;

    if (err instanceof Error && err.name === "AbortError") {
      throw err;
    }

    return {
      status: "down",
      latencyMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// --- Polling ---

/**
 * Poll Gateway health until it reports "up" or timeout expires.
 * Resolves with the final health result, or throws HealthPollTimeout.
 */
export async function pollGatewayHealth(
  options: HealthPollOptions = {},
): Promise<HealthCheckResult> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const signal = options.signal;

  const start = Date.now();
  let lastStatus: GatewayHealthStatus = "down";

  while (Date.now() - start < timeoutMs) {
    signal?.throwIfAborted();

    const result = await checkHealth({
      host: options.host,
      port: options.port,
      signal,
    });

    lastStatus = result.status;

    if (result.status === "up") {
      return result;
    }

    // Wait before next poll
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, intervalMs);
      if (signal) {
        const onAbort = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  throw new HealthPollTimeout(lastStatus, timeoutMs);
}

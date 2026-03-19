/**
 * Post-deploy health verification and smoke test.
 *
 * Waits for the Gateway to become reachable after compose up,
 * then runs a smoke test RPC call. Retries with exponential
 * backoff until timeout. Supports AbortSignal for cancellation.
 */

import { GatewayClient } from "../../gateway/index.js";

import type { HealthVerifyOptions, HealthVerifyResult } from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_INTERVAL_MS = 2_000;
const MAX_INTERVAL_MS = 10_000;
const RPC_TIMEOUT_MS = 5_000;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Wait for the Gateway to become healthy after deploy.
 *
 * Connects via WebSocket RPC and calls "status" to verify the
 * Gateway is up and accepting requests. Retries with exponential
 * backoff until timeout or AbortSignal fires.
 */
export async function verifyHealth(options: HealthVerifyOptions): Promise<HealthVerifyResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseInterval = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const host = options.gatewayHost ?? "127.0.0.1";
  const port = options.gatewayPort ?? 18789;
  const start = Date.now();
  let attempts = 0;
  let interval = baseInterval;

  while (Date.now() - start < timeoutMs) {
    if (options.signal?.aborted) {
      return {
        healthy: false,
        attempts,
        elapsedMs: Date.now() - start,
        error: "Health verification aborted",
      };
    }

    attempts++;
    const client = new GatewayClient({
      token: options.gatewayToken,
      host,
      port,
      timeoutMs: RPC_TIMEOUT_MS,
    });

    try {
      await client.connect(options.signal);
      await client.rpc("status", undefined, { timeoutMs: RPC_TIMEOUT_MS });
      client.close();

      return {
        healthy: true,
        attempts,
        elapsedMs: Date.now() - start,
      };
    } catch {
      client.close();
    }

    // Wait before retrying (exponential backoff capped at MAX_INTERVAL_MS)
    await sleep(Math.min(interval, MAX_INTERVAL_MS), options.signal);
    interval = Math.min(interval * 1.5, MAX_INTERVAL_MS);
  }

  return {
    healthy: false,
    attempts,
    elapsedMs: Date.now() - start,
    error: `Gateway did not become healthy within ${timeoutMs}ms (${attempts} attempts)`,
  };
}

/**
 * Run a smoke test against a running Gateway.
 *
 * Verifies the Gateway responds to a basic RPC call. This is the
 * final check in the deploy sequence — confirms the agent is reachable.
 */
export async function smokeTest(options: HealthVerifyOptions): Promise<HealthVerifyResult> {
  const host = options.gatewayHost ?? "127.0.0.1";
  const port = options.gatewayPort ?? 18789;
  const start = Date.now();

  const client = new GatewayClient({
    token: options.gatewayToken,
    host,
    port,
    timeoutMs: RPC_TIMEOUT_MS,
  });

  try {
    await client.connect(options.signal);
    await client.rpc("status", undefined, { timeoutMs: RPC_TIMEOUT_MS });
    client.close();

    return {
      healthy: true,
      attempts: 1,
      elapsedMs: Date.now() - start,
    };
  } catch (err) {
    client.close();
    const message = err instanceof Error ? err.message : String(err);
    return {
      healthy: false,
      attempts: 1,
      elapsedMs: Date.now() - start,
      error: `Smoke test failed: ${message}`,
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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

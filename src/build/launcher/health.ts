/**
 * Post-deploy health verification and smoke test.
 *
 * Waits for the Gateway to become reachable after compose up,
 * then runs a smoke test that sends a real message to the agent
 * and verifies a response. "Container started" is not "agent works."
 *
 * Retries with exponential backoff until timeout. Supports AbortSignal.
 */

import {
  DEPLOY_HEALTH_INTERVAL_MS,
  DEPLOY_HEALTH_MAX_INTERVAL_MS,
  DEPLOY_HEALTH_TIMEOUT_MS,
  DEPLOY_RPC_TIMEOUT_MS,
  DEPLOY_SMOKE_TIMEOUT_MS,
  GATEWAY_DEFAULT_PORT,
} from "../../config/defaults.js";
import { GatewayClient } from "../../gateway/index.js";

import type { HealthVerifyOptions, HealthVerifyResult, SmokeTestOptions, SmokeTestResult } from "./types.js";

const SMOKE_TEST_MESSAGE = "clawhq smoke test — please respond with any message to confirm you are operational.";

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Wait for the Gateway to become healthy after deploy.
 *
 * Connects via WebSocket RPC and calls "status" to verify the
 * Gateway is up and accepting requests. Retries with exponential
 * backoff until timeout or AbortSignal fires.
 */
export async function verifyHealth(options: HealthVerifyOptions): Promise<HealthVerifyResult> {
  const timeoutMs = options.timeoutMs ?? DEPLOY_HEALTH_TIMEOUT_MS;
  const baseInterval = options.intervalMs ?? DEPLOY_HEALTH_INTERVAL_MS;
  const host = options.gatewayHost ?? "127.0.0.1";
  const port = options.gatewayPort ?? GATEWAY_DEFAULT_PORT;
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
      timeoutMs: DEPLOY_RPC_TIMEOUT_MS,
    });

    try {
      await client.connect(options.signal);
      await client.rpc("status", undefined, { timeoutMs: DEPLOY_RPC_TIMEOUT_MS });
      client.close();

      return {
        healthy: true,
        attempts,
        elapsedMs: Date.now() - start,
      };
    } catch (e) {
      console.warn(`[health:wait] Gateway health check attempt ${attempts} failed:`, e);
      client.close();
    }

    // Wait before retrying (exponential backoff capped at MAX_INTERVAL_MS)
    await sleep(Math.min(interval, DEPLOY_HEALTH_MAX_INTERVAL_MS), options.signal);
    interval = Math.min(interval * 1.5, DEPLOY_HEALTH_MAX_INTERVAL_MS);
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
 * Sends a real message to the agent via Gateway RPC and verifies the
 * agent responds. "Container started" is not "agent works" — this test
 * proves the full pipeline: Gateway → session → agent → response.
 *
 * Falls back to status-only verification if the Gateway does not support
 * `sessions.send` (older OpenClaw versions).
 */
export async function smokeTest(options: SmokeTestOptions): Promise<SmokeTestResult> {
  const host = options.gatewayHost ?? "127.0.0.1";
  const port = options.gatewayPort ?? GATEWAY_DEFAULT_PORT;
  const start = Date.now();
  const timeoutMs = options.smokeTimeoutMs ?? DEPLOY_SMOKE_TIMEOUT_MS;
  const message = options.smokeMessage ?? SMOKE_TEST_MESSAGE;

  const client = new GatewayClient({
    token: options.gatewayToken,
    host,
    port,
    timeoutMs,
  });

  try {
    await client.connect(options.signal);

    // Step 1: Verify Gateway is responsive
    await client.rpc("status", undefined, { timeoutMs: DEPLOY_RPC_TIMEOUT_MS });

    // Step 2: Send a real message and wait for the agent's response
    try {
      const response = await client.rpc(
        "sessions.send",
        { message, session: "smoke-test" },
        { timeoutMs, signal: options.signal },
      ) as { reply?: string } | undefined;

      client.close();

      const reply = response?.reply;
      if (reply) {
        return {
          healthy: true,
          attempts: 1,
          elapsedMs: Date.now() - start,
          messageSent: true,
          responseReceived: true,
          agentReply: typeof reply === "string" ? reply.slice(0, 200) : String(reply).slice(0, 200),
        };
      }

      // Gateway accepted the RPC but agent didn't reply
      return {
        healthy: false,
        attempts: 1,
        elapsedMs: Date.now() - start,
        messageSent: true,
        responseReceived: false,
        error: smokeFailureGuide("Agent received the message but did not respond", options),
      };
    } catch (sessionErr) {
      client.close();

      // If sessions.send is not supported, fall back to status-only
      const errMsg = sessionErr instanceof Error ? sessionErr.message : String(sessionErr);
      if (errMsg.includes("unknown method") || errMsg.includes("not found") || errMsg.includes("not supported")) {
        return {
          healthy: true,
          attempts: 1,
          elapsedMs: Date.now() - start,
          messageSent: false,
          responseReceived: false,
          fallback: true,
        };
      }

      // Real failure — agent pipeline is broken
      return {
        healthy: false,
        attempts: 1,
        elapsedMs: Date.now() - start,
        messageSent: false,
        responseReceived: false,
        error: smokeFailureGuide(errMsg, options),
      };
    }
  } catch (err) {
    client.close();
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      healthy: false,
      attempts: 1,
      elapsedMs: Date.now() - start,
      messageSent: false,
      responseReceived: false,
      error: smokeFailureGuide(errMsg, options),
    };
  }
}

/**
 * Build actionable fix guidance for smoke test failures.
 */
function smokeFailureGuide(rawError: string, options: SmokeTestOptions): string {
  const port = options.gatewayPort ?? GATEWAY_DEFAULT_PORT;
  const lines = [`Smoke test failed: ${rawError}`];

  lines.push("");
  lines.push("The agent container is running but not responding to messages.");
  lines.push("This means 'clawhq up' did NOT produce a working agent.");
  lines.push("");
  lines.push("Troubleshooting:");
  lines.push(`  1. Check agent logs:  clawhq logs -f`);
  lines.push(`  2. Run diagnostics:   clawhq doctor --fix`);
  lines.push(`  3. Verify model:      Is Ollama running? Is the configured model pulled?`);
  lines.push(`  4. Check Gateway:     curl -s http://127.0.0.1:${port}/health`);
  lines.push(`  5. Restart agent:     clawhq restart`);

  return lines.join("\n");
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

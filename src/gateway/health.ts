/**
 * Health polling for the OpenClaw Gateway.
 *
 * Periodically checks Gateway availability by attempting an RPC call.
 * Reports state transitions (up/down) via a callback. Supports
 * AbortSignal for clean shutdown.
 */

import { GatewayClient } from "./client.js";
import type {
  GatewayClientOptions,
  HealthChangeCallback,
  HealthPollOptions,
  HealthState,
} from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 5_000;

// ── Health Poller ────────────────────────────────────────────────────────────

/**
 * Polls the Gateway to detect up/down state changes.
 *
 * Creates a fresh WebSocket connection per check to avoid stale-connection
 * false positives. Invokes the callback only on state transitions.
 */
export class HealthPoller {
  private readonly clientOptions: GatewayClientOptions;
  private readonly intervalMs: number;
  private readonly healthTimeoutMs: number;
  private readonly onChange: HealthChangeCallback;

  private state: HealthState = "unknown";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(
    clientOptions: GatewayClientOptions,
    onChange: HealthChangeCallback,
    options?: HealthPollOptions,
  ) {
    this.clientOptions = clientOptions;
    this.onChange = onChange;
    this.intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.healthTimeoutMs = options?.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;

    if (options?.signal) {
      options.signal.addEventListener("abort", () => this.stop(), { once: true });
    }
  }

  /** Current health state. */
  get currentState(): HealthState {
    return this.state;
  }

  /** Start the polling loop. Does an immediate check, then repeats on interval. */
  start(): void {
    if (this.running) return;
    this.running = true;
    void this.poll();
  }

  /** Stop the polling loop. */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    if (!this.running) return;

    const newState = await this.check();
    const previous = this.state;

    if (newState !== previous) {
      this.state = newState;
      this.onChange(newState, previous);
    }

    if (this.running) {
      this.timer = setTimeout(() => void this.poll(), this.intervalMs);
    }
  }

  private async check(): Promise<HealthState> {
    const client = new GatewayClient({
      ...this.clientOptions,
      timeoutMs: this.healthTimeoutMs,
    });

    try {
      await client.connect();
      await client.rpc("status", undefined, { timeoutMs: this.healthTimeoutMs });
      return "up";
    } catch {
      return "down";
    } finally {
      client.close();
    }
  }
}

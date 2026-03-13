/**
 * Config management wrappers for the OpenClaw Gateway.
 *
 * Provides config.patch and config.apply RPC calls that respect the
 * Gateway's rate limit (3 req/60s). When the Gateway is unavailable,
 * falls back to direct filesystem writes.
 */

import { readFile, writeFile } from "node:fs/promises";

import type { GatewayClient, RpcResponse } from "./websocket.js";
import { GatewayError, RateLimitError } from "./websocket.js";

// --- Types ---

export interface ConfigPatchOptions {
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

export interface ConfigRpcClientOptions {
  /** Path to openclaw.json for filesystem fallback. */
  configPath: string;
  /** Rate limit: max requests per window (default: 3). */
  maxRequests?: number;
  /** Rate limit window in ms (default: 60000). */
  windowMs?: number;
}

export interface ConfigWriteResult {
  /** Whether the write went through WebSocket RPC or filesystem fallback. */
  method: "rpc" | "filesystem";
  /** The RPC response (only present for rpc method). */
  response?: RpcResponse;
}

// --- Rate limiter ---

export class SlidingWindowRateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly timestamps: number[] = [];

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /**
   * Check if a request can proceed. Returns true if under the limit.
   * If over the limit, returns false.
   */
  canProceed(): boolean {
    this.prune();
    return this.timestamps.length < this.maxRequests;
  }

  /** Record a request timestamp. */
  record(): void {
    this.timestamps.push(Date.now());
  }

  /** Time in ms until the next request can proceed. Returns 0 if under limit. */
  retryAfterMs(): number {
    this.prune();
    if (this.timestamps.length < this.maxRequests) return 0;
    const oldest = this.timestamps[0];
    return Math.max(0, oldest + this.windowMs - Date.now());
  }

  /** Remove timestamps outside the current window. */
  private prune(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] <= cutoff) {
      this.timestamps.shift();
    }
  }
}

// --- Config RPC client ---

export class ConfigRpcClient {
  private readonly gateway: GatewayClient;
  private readonly configPath: string;
  private readonly rateLimiter: SlidingWindowRateLimiter;

  constructor(gateway: GatewayClient, options: ConfigRpcClientOptions) {
    this.gateway = gateway;
    this.configPath = options.configPath;
    this.rateLimiter = new SlidingWindowRateLimiter(
      options.maxRequests ?? 3,
      options.windowMs ?? 60_000,
    );
  }

  /**
   * Patch the OpenClaw config via Gateway RPC.
   * Falls back to direct filesystem write when Gateway is unavailable.
   * Throws RateLimitError if the rate limit would be exceeded.
   */
  async patch(
    patch: Record<string, unknown>,
    options: ConfigPatchOptions = {},
  ): Promise<ConfigWriteResult> {
    const signal = options.signal;
    signal?.throwIfAborted();

    // Try RPC first if connected
    if (this.gateway.connected) {
      if (!this.rateLimiter.canProceed()) {
        throw new RateLimitError(this.rateLimiter.retryAfterMs());
      }

      this.rateLimiter.record();
      const response = await this.gateway.call("config.patch", { patch }, { signal });
      return { method: "rpc", response };
    }

    // Fallback: direct filesystem write
    return this.filesystemPatch(patch, signal);
  }

  /**
   * Apply (full replace) the OpenClaw config via Gateway RPC.
   * Falls back to direct filesystem write when Gateway is unavailable.
   * Throws RateLimitError if the rate limit would be exceeded.
   */
  async apply(
    config: Record<string, unknown>,
    options: ConfigPatchOptions = {},
  ): Promise<ConfigWriteResult> {
    const signal = options.signal;
    signal?.throwIfAborted();

    // Try RPC first if connected
    if (this.gateway.connected) {
      if (!this.rateLimiter.canProceed()) {
        throw new RateLimitError(this.rateLimiter.retryAfterMs());
      }

      this.rateLimiter.record();
      const response = await this.gateway.call("config.apply", { config }, { signal });
      return { method: "rpc", response };
    }

    // Fallback: direct filesystem write (full replace)
    return this.filesystemApply(config, signal);
  }

  /**
   * Read-merge-write the config file, applying the patch on top.
   */
  private async filesystemPatch(
    patch: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ConfigWriteResult> {
    signal?.throwIfAborted();

    let existing: Record<string, unknown> = {};
    try {
      const content = await readFile(this.configPath, "utf-8");
      existing = JSON.parse(content) as Record<string, unknown>;
    } catch (err: unknown) {
      // If file doesn't exist, start with empty config
      if (!(err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT")) {
        throw new GatewayError(`Failed to read config at ${this.configPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const merged = shallowMergePatch(existing, patch);
    await writeFile(this.configPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
    return { method: "filesystem" };
  }

  /**
   * Write the full config to the filesystem.
   */
  private async filesystemApply(
    config: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ConfigWriteResult> {
    signal?.throwIfAborted();
    await writeFile(this.configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    return { method: "filesystem" };
  }
}

/**
 * Shallow merge patch onto base — top-level keys from patch overwrite base.
 * Matches the semantics of Gateway's config.patch RPC.
 */
function shallowMergePatch(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...base, ...patch };
}

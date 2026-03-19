/**
 * Token-authenticated WebSocket RPC client for the OpenClaw Gateway.
 *
 * Communicates with the Gateway process at :18789 using a JSON-RPC-style
 * protocol over WebSocket. Supports request/response RPC with typed errors,
 * configurable timeouts, and AbortSignal cancellation.
 *
 * AD-03: Tight coupling to OpenClaw — uses Gateway's WebSocket RPC directly.
 */

import WebSocket from "ws";

import {
  AuthError,
  ConnectionError,
  GatewayError,
  RateLimitError,
  RpcTimeoutError,
} from "./errors.js";
import type {
  GatewayClientOptions,
  RpcRequest,
  RpcResponse,
} from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 18789;
const DEFAULT_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 5_000;

// ── RPC Error Codes ──────────────────────────────────────────────────────────

const AUTH_ERROR_CODE = 401;
const RATE_LIMIT_ERROR_CODE = 429;

// ── Pending Request Tracker ──────────────────────────────────────────────────

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ── Client ───────────────────────────────────────────────────────────────────

/**
 * WebSocket RPC client for the OpenClaw Gateway.
 *
 * Usage:
 * ```ts
 * const client = new GatewayClient({ token: "my-token" });
 * await client.connect();
 * const status = await client.rpc("status");
 * client.close();
 * ```
 */
export class GatewayClient {
  private readonly host: string;
  private readonly port: number;
  private readonly token: string;
  private readonly timeoutMs: number;

  private ws: WebSocket | null = null;
  private requestId = 0;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(options: GatewayClientOptions) {
    this.host = options.host ?? DEFAULT_HOST;
    this.port = options.port ?? DEFAULT_PORT;
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Whether the client has an open WebSocket connection. */
  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Open a WebSocket connection to the Gateway.
   *
   * The token is sent as a query parameter on the upgrade request,
   * matching the Gateway's authentication pattern.
   */
  async connect(signal?: AbortSignal): Promise<void> {
    if (this.connected) return;

    signal?.throwIfAborted();

    const url = `ws://${this.host}:${this.port}?token=${encodeURIComponent(this.token)}`;

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);

      const connectTimer = setTimeout(() => {
        ws.close();
        reject(new ConnectionError(`Connection to Gateway timed out after ${CONNECT_TIMEOUT_MS}ms`));
      }, CONNECT_TIMEOUT_MS);

      const onAbort = () => {
        clearTimeout(connectTimer);
        ws.close();
        reject(new ConnectionError("Connection aborted"));
      };

      signal?.addEventListener("abort", onAbort, { once: true });

      ws.addEventListener("open", () => {
        clearTimeout(connectTimer);
        signal?.removeEventListener("abort", onAbort);
        this.ws = ws;
        this.attachHandlers(ws);
        resolve();
      });

      ws.addEventListener("error", () => {
        clearTimeout(connectTimer);
        signal?.removeEventListener("abort", onAbort);
        reject(new ConnectionError("WebSocket connection failed"));
      });
    });
  }

  /**
   * Send an RPC request and wait for the response.
   *
   * @param method - RPC method name (e.g. "config.patch", "status").
   * @param params - Optional parameters for the method.
   * @param options - Per-call overrides for timeout and abort signal.
   * @returns The result field from the RPC response.
   */
  async rpc(
    method: string,
    params?: Record<string, unknown>,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<unknown> {
    if (!this.connected || !this.ws) {
      throw new ConnectionError("Not connected to Gateway");
    }

    options?.signal?.throwIfAborted();

    const id = String(++this.requestId);
    const timeoutMs = options?.timeoutMs ?? this.timeoutMs;

    const request: RpcRequest = { id, method, ...(params && { params }) };

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcTimeoutError(method, timeoutMs));
      }, timeoutMs);

      const onAbort = () => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new GatewayError(`RPC call "${method}" aborted`));
      };

      options?.signal?.addEventListener("abort", onAbort, { once: true });

      this.pending.set(id, {
        resolve: (value) => {
          options?.signal?.removeEventListener("abort", onAbort);
          resolve(value);
        },
        reject: (reason) => {
          options?.signal?.removeEventListener("abort", onAbort);
          reject(reason);
        },
        timer,
      });

      const ws = this.ws as WebSocket;
      ws.send(JSON.stringify(request));
    });
  }

  /** Close the WebSocket connection and reject all pending requests. */
  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.rejectAllPending(new ConnectionError("Client closed"));
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private attachHandlers(ws: WebSocket): void {
    ws.addEventListener("message", (event) => {
      this.handleMessage(event.data);
    });

    ws.addEventListener("close", (event) => {
      this.ws = null;
      this.rejectAllPending(
        new ConnectionError("WebSocket closed", event.code),
      );
    });

    ws.addEventListener("error", () => {
      // Close event will follow and clean up pending requests.
    });
  }

  private handleMessage(data: unknown): void {
    let response: RpcResponse;
    try {
      const text = typeof data === "string" ? data : String(data);
      response = JSON.parse(text) as RpcResponse;
    } catch {
      return; // Ignore non-JSON messages.
    }

    const pending = this.pending.get(response.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(response.id);

    if (response.error) {
      pending.reject(this.toTypedError(response.error));
    } else {
      pending.resolve(response.result);
    }
  }

  private toTypedError(payload: { code: number; message: string; data?: unknown }): GatewayError {
    if (payload.code === AUTH_ERROR_CODE) {
      return new AuthError(payload.message);
    }
    if (payload.code === RATE_LIMIT_ERROR_CODE) {
      const retryAfter = typeof payload.data === "number" ? payload.data : undefined;
      return new RateLimitError(payload.message, retryAfter);
    }
    return new GatewayError(payload.message);
  }

  private rejectAllPending(error: GatewayError): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

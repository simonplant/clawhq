/**
 * WebSocket RPC client for the OpenClaw Gateway at :18789.
 *
 * Token-authenticated, request/response RPC pattern with typed message
 * envelopes and timeout handling. All operations accept AbortSignal.
 */

import { EventEmitter } from "node:events";

// --- Typed errors ---

export class GatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayError";
  }
}

export class ConnectionError extends GatewayError {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "ConnectionError";
  }
}

export class AuthError extends GatewayError {
  constructor(message: string = "Authentication failed") {
    super(message);
    this.name = "AuthError";
  }
}

export class RateLimitError extends GatewayError {
  public readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super(`Rate limited — retry after ${retryAfterMs}ms`);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class RpcTimeoutError extends GatewayError {
  constructor(
    public readonly method: string,
    public readonly timeoutMs: number,
  ) {
    super(`RPC call "${method}" timed out after ${timeoutMs}ms`);
    this.name = "RpcTimeoutError";
  }
}

// --- RPC message types ---

export interface RpcRequest {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface RpcResponseOk {
  id: string;
  result: unknown;
  error?: undefined;
}

export interface RpcResponseError {
  id: string;
  result?: undefined;
  error: {
    code: number;
    message: string;
  };
}

export type RpcResponse = RpcResponseOk | RpcResponseError;

// --- WebSocket abstraction ---

/**
 * Minimal WebSocket interface for dependency injection.
 * Compatible with the built-in `WebSocket` global (Node 21+) and `ws` library.
 */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: string,
    listener: (event: { data?: unknown; code?: number; reason?: string; message?: string }) => void,
  ): void;
  removeEventListener(
    type: string,
    listener: (event: { data?: unknown; code?: number; reason?: string; message?: string }) => void,
  ): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

// --- Client options ---

export interface GatewayClientOptions {
  /** Gateway host (default: "127.0.0.1"). */
  host?: string;
  /** Gateway port (default: 18789). */
  port?: number;
  /** Auth token for the Gateway. */
  token?: string;
  /** RPC call timeout in ms (default: 10000). */
  rpcTimeoutMs?: number;
  /** Factory to create WebSocket instances (for testing). */
  createWebSocket?: WebSocketFactory;
}

// --- Constants ---

const WS_OPEN = 1;

// --- Client ---

export class GatewayClient extends EventEmitter {
  private readonly host: string;
  private readonly port: number;
  private readonly token: string | undefined;
  private readonly rpcTimeoutMs: number;
  private readonly createWebSocket: WebSocketFactory;

  private ws: WebSocketLike | null = null;
  private messageSeq = 0;
  private readonly pending = new Map<
    string,
    { resolve: (value: RpcResponse) => void; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(options: GatewayClientOptions = {}) {
    super();
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 18789;
    this.token = options.token;
    this.rpcTimeoutMs = options.rpcTimeoutMs ?? 10_000;
    this.createWebSocket = options.createWebSocket ?? defaultWebSocketFactory;
  }

  /** Whether the WebSocket connection is open. */
  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WS_OPEN;
  }

  /**
   * Connect to the Gateway WebSocket.
   * Resolves when the connection is established and authenticated.
   */
  async connect(options: { signal?: AbortSignal } = {}): Promise<void> {
    const signal = options.signal;
    signal?.throwIfAborted();

    if (this.connected) return;

    const url = `ws://${this.host}:${this.port}`;
    const ws = this.createWebSocket(url);

    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        ws.removeEventListener("open", onOpen);
        ws.removeEventListener("error", onError);
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
      };

      const onOpen = () => {
        cleanup();
        this.ws = ws;
        this.setupListeners(ws);

        // Authenticate if token is provided
        if (this.token) {
          this.call("auth", { token: this.token }, { signal })
            .then((response) => {
              if (response.error) {
                this.ws = null;
                ws.close();
                reject(new AuthError(response.error.message));
              } else {
                resolve();
              }
            })
            .catch((err: unknown) => {
              this.ws = null;
              ws.close();
              reject(err);
            });
        } else {
          resolve();
        }
      };

      const onError = (event: { message?: string }) => {
        cleanup();
        reject(new ConnectionError(
          `Failed to connect to Gateway at ${url}`,
          event.message ? new Error(event.message) : undefined,
        ));
      };

      const onAbort = () => {
        cleanup();
        ws.close();
        reject(signal?.reason);
      };

      ws.addEventListener("open", onOpen);
      ws.addEventListener("error", onError);

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  /** Disconnect from the Gateway. */
  disconnect(): void {
    if (this.ws) {
      this.ws.close(1000, "client disconnect");
      this.ws = null;
    }

    // Reject all pending RPCs
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.resolve({
        id,
        error: { code: -1, message: "Client disconnected" },
      });
    }
  }

  /**
   * Send an RPC request and wait for the response.
   * Throws RpcTimeoutError if the response doesn't arrive within the timeout.
   */
  async call(
    method: string,
    params?: Record<string, unknown>,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<RpcResponse> {
    const signal = options.signal;
    signal?.throwIfAborted();

    if (!this.ws || this.ws.readyState !== WS_OPEN) {
      throw new ConnectionError("Not connected to Gateway");
    }

    const id = this.nextId();
    const timeoutMs = options.timeoutMs ?? this.rpcTimeoutMs;

    const request: RpcRequest = { id, method };
    if (params !== undefined) {
      request.params = params;
    }

    return new Promise<RpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcTimeoutError(method, timeoutMs));
      }, timeoutMs);

      const onAbort = () => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(signal?.reason);
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      this.pending.set(id, {
        resolve: (response: RpcResponse) => {
          clearTimeout(timer);
          if (signal) {
            signal.removeEventListener("abort", onAbort);
          }
          resolve(response);
        },
        timer,
      });

      // ws is guaranteed non-null here — checked at method entry
      const ws = this.ws as WebSocketLike;
      ws.send(JSON.stringify(request));
    });
  }

  private nextId(): string {
    this.messageSeq += 1;
    return `rpc-${this.messageSeq}`;
  }

  private setupListeners(ws: WebSocketLike): void {
    const onMessage = (event: { data?: unknown }) => {
      const raw = typeof event.data === "string" ? event.data : String(event.data);
      let response: RpcResponse;
      try {
        response = JSON.parse(raw) as RpcResponse;
      } catch {
        return; // Ignore non-JSON messages
      }

      const entry = response.id ? this.pending.get(response.id) : undefined;
      if (entry) {
        this.pending.delete(response.id);
        entry.resolve(response);
      }
    };

    const onClose = (event: { code?: number; reason?: string }) => {
      this.ws = null;
      this.emit("close", event.code, event.reason);

      // Reject all pending RPCs
      for (const [id, entry] of this.pending) {
        clearTimeout(entry.timer);
        this.pending.delete(id);
        entry.resolve({
          id,
          error: { code: -1, message: "Connection closed" },
        });
      }
    };

    const onError = (event: { message?: string }) => {
      this.emit("error", new ConnectionError(event.message ?? "WebSocket error"));
    };

    ws.addEventListener("message", onMessage);
    ws.addEventListener("close", onClose);
    ws.addEventListener("error", onError);
  }
}

/** Default factory — uses Node.js built-in WebSocket (Node 21+). */
function defaultWebSocketFactory(url: string): WebSocketLike {
  return new WebSocket(url) as unknown as WebSocketLike;
}

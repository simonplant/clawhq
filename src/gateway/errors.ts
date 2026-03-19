/**
 * Gateway error classes for OpenClaw WebSocket RPC communication.
 *
 * Error hierarchy:
 *   GatewayError (base)
 *   ├── ConnectionError  — WebSocket connect/close failures
 *   ├── AuthError         — Token rejected or missing
 *   ├── RateLimitError    — Gateway rate limit exceeded (3 req/60s for config writes)
 *   └── RpcTimeoutError   — RPC response not received within deadline
 */

// ── Base Error ───────────────────────────────────────────────────────────────

/** Base error for all Gateway communication failures. */
export class GatewayError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GatewayError";
  }
}

// ── Connection Error ─────────────────────────────────────────────────────────

/** WebSocket connection failed or was unexpectedly closed. */
export class ConnectionError extends GatewayError {
  readonly code?: number;

  constructor(message: string, code?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConnectionError";
    this.code = code;
  }
}

// ── Auth Error ───────────────────────────────────────────────────────────────

/** Gateway rejected the authentication token. */
export class AuthError extends GatewayError {
  constructor(message = "Gateway authentication failed", options?: ErrorOptions) {
    super(message, options);
    this.name = "AuthError";
  }
}

// ── Rate Limit Error ─────────────────────────────────────────────────────────

/** Gateway rate limit exceeded. */
export class RateLimitError extends GatewayError {
  readonly retryAfterMs?: number;

  constructor(message = "Gateway rate limit exceeded", retryAfterMs?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

// ── RPC Timeout Error ────────────────────────────────────────────────────────

/** RPC call did not receive a response within the deadline. */
export class RpcTimeoutError extends GatewayError {
  readonly method: string;
  readonly timeoutMs: number;

  constructor(method: string, timeoutMs: number, options?: ErrorOptions) {
    super(`RPC call "${method}" timed out after ${timeoutMs}ms`, options);
    this.name = "RpcTimeoutError";
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}

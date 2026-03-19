/**
 * OpenClaw Gateway communication module (cross-cutting).
 *
 * Provides a token-authenticated WebSocket RPC client for talking to a
 * running OpenClaw Gateway, plus health polling for detecting up/down state.
 */

// Client
export { GatewayClient } from "./client.js";

// Health
export { HealthPoller } from "./health.js";

// Errors
export {
  AuthError,
  ConnectionError,
  GatewayError,
  RateLimitError,
  RpcTimeoutError,
} from "./errors.js";

// Types
export type {
  GatewayClientOptions,
  HealthChangeCallback,
  HealthPollOptions,
  HealthState,
  RpcErrorPayload,
  RpcRequest,
  RpcResponse,
} from "./types.js";

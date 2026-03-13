/**
 * OpenClaw Gateway communication — WebSocket RPC, health checks, config management.
 * See docs/ARCHITECTURE.md for module responsibilities.
 */

export {
  GatewayClient,
  GatewayError,
  ConnectionError,
  AuthError,
  RateLimitError,
  RpcTimeoutError,
} from "./websocket.js";

export type {
  GatewayClientOptions,
  RpcRequest,
  RpcResponse,
  RpcResponseOk,
  RpcResponseError,
  WebSocketLike,
  WebSocketFactory,
} from "./websocket.js";

export {
  checkHealth,
  pollGatewayHealth,
  HealthPollTimeout,
} from "./health.js";

export type {
  GatewayHealthStatus,
  HealthCheckResult,
  HealthPollOptions,
} from "./health.js";

export {
  ConfigRpcClient,
  SlidingWindowRateLimiter,
} from "./config-rpc.js";

export type {
  ConfigPatchOptions,
  ConfigRpcClientOptions,
  ConfigWriteResult,
} from "./config-rpc.js";

/**
 * Cloud module — trust modes, heartbeat, command queue.
 *
 * Optional layer for remote monitoring and managed hosting.
 * Zero-trust by design: agent-initiated only, signed commands,
 * content architecturally blocked.
 */

// Types
export type {
  CloudCommandType,
  CommandDisposition,
  CommandQueueState,
  CommandResult,
  DisconnectResult,
  HeartbeatResult,
  HeartbeatState,
  HealthReport,
  SignedCommand,
  SwitchModeResult,
  TrustModeState,
  VerifyResult,
} from "./types.js";

// Trust modes
export {
  connectCloud,
  disconnectCloud,
  getAllowedCommands,
  getCommandDisposition,
  isArchitecturallyBlocked,
  isCommandSupported,
  readTrustModeState,
  switchTrustMode,
  trustModePath,
} from "./trust-modes/index.js";

// Heartbeat
export {
  collectHealthReport,
  heartbeatPath,
  readHeartbeatState,
  sendHeartbeat,
} from "./heartbeat/index.js";

// Commands
export {
  buildSignatureMessage,
  commandQueuePath,
  enqueueCommand,
  processAllCommands,
  processNextCommand,
  readQueueState,
  verifyCommandSignature,
} from "./commands/index.js";

// Formatters
export type { CloudStatusSnapshot } from "./formatters.js";
export {
  formatCloudStatus,
  formatCloudStatusJson,
  formatDisconnectResult,
  formatSwitchResult,
} from "./formatters.js";

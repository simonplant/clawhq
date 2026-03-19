/**
 * Heartbeat — outbound health reporter.
 *
 * Agent-initiated only. Reports operational metadata, never content.
 */

export {
  collectHealthReport,
  heartbeatPath,
  readHeartbeatState,
  sendHeartbeat,
} from "./reporter.js";

/**
 * Session management — public API.
 *
 * Detect and recover runaway OpenClaw sessions. Use these operations
 * instead of touching session files directly on the host; they go
 * through `docker exec` so state stays coherent with the running gateway.
 */

export { archiveSession } from "./archive.js";
export { hasRunawaySession, listSessions } from "./detect.js";
export type {
  ArchiveResult,
  RunawayFlag,
  RunawayThresholds,
  SessionInfo,
} from "./types.js";

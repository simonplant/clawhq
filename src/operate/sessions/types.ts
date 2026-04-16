/**
 * Session management types.
 *
 * Sessions are OpenClaw conversation state files (JSONL) living inside
 * the running container at /home/node/.openclaw/agents/main/sessions/.
 *
 * A runaway session is one where a tool-call loop has inflated the file
 * beyond sane thresholds — it will hammer the LLM, burn GPU, and re-enter
 * the loop on every auto-compact. ClawHQ detects and archives these.
 */

/** A single session on disk (inside the container). */
export interface SessionInfo {
  /** Session UUID (filename without .jsonl). */
  readonly id: string;
  /** Full filename (e.g. "f735a1c7-...jsonl"). */
  readonly file: string;
  /** File size in bytes. */
  readonly sizeBytes: number;
  /** Number of JSONL lines (messages). */
  readonly messageCount: number;
  /** Last modified time (ISO 8601). */
  readonly mtime: string;
  /** Session key in sessions.json (e.g. "agent:main:telegram:direct:5772231927"), if indexed. */
  readonly indexKey?: string;
  /** Why this session is flagged as runaway, if any. Empty if healthy. */
  readonly flags: readonly RunawayFlag[];
}

/** Reason a session is flagged as runaway. */
export type RunawayFlag =
  | "message-count-excessive"
  | "size-excessive"
  | "active-too-long";

/** Thresholds for runaway detection. */
export interface RunawayThresholds {
  /** Max messages before flagging (default: 500). */
  readonly maxMessages?: number;
  /** Max file size in bytes before flagging (default: 5 MB). */
  readonly maxSizeBytes?: number;
  /** Max session age in ms before flagging (default: 24h). */
  readonly maxActiveMs?: number;
}

/** Result of an archive operation. */
export interface ArchiveResult {
  readonly sessionId: string;
  readonly success: boolean;
  readonly message: string;
  /** Files that were archived. */
  readonly archivedFiles: readonly string[];
  /** Whether sessions.json was updated. */
  readonly indexUpdated: boolean;
  /** Whether the container was restarted to release file descriptors. */
  readonly containerRestarted: boolean;
}

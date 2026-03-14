/**
 * Types for the log streaming module.
 */

export type LogCategory = "agent" | "gateway" | "cron" | "error";

export interface LogsOptions {
  /** OpenClaw home directory. */
  openclawHome: string;
  /** Follow (tail -f) mode. */
  follow?: boolean;
  /** Filter by log category. */
  category?: LogCategory;
  /** Show cron execution history for a specific job. */
  cronJob?: string;
  /** Time-bounded output (e.g. "1h", "30m", "2d"). */
  since?: string;
  /** Number of tail lines (default: all). */
  tail?: number;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
}

export interface CronRunEntry {
  /** ISO timestamp of the run. */
  timestamp: string;
  /** Job ID. */
  jobId: string;
  /** Whether the run succeeded. */
  success: boolean;
  /** Duration in milliseconds. */
  durationMs?: number;
  /** Output or error message. */
  output?: string;
  /** Error message if failed. */
  error?: string;
}

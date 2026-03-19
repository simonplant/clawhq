/**
 * Types for agent log streaming.
 *
 * `clawhq logs [-f] [-n lines]` streams Docker container logs.
 */

/** Options for streaming agent logs. */
export interface LogsOptions {
  /** Path to the deployment directory. */
  readonly deployDir: string;
  /** Follow log output (tail -f style). */
  readonly follow?: boolean;
  /** Number of lines to show from the end. */
  readonly lines?: number;
  /** AbortSignal for cancellation. */
  readonly signal?: AbortSignal;
  /** Callback for each log line. */
  readonly onLine?: (line: string) => void;
}

/** Result of a non-follow log read. */
export interface LogsResult {
  readonly success: boolean;
  readonly output?: string;
  readonly lineCount?: number;
  readonly error?: string;
}

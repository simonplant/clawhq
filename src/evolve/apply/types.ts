/**
 * Types for `clawhq apply` — idempotent config regeneration.
 */

/** Options for the apply operation. */
export interface ApplyOptions {
  readonly deployDir: string;
  readonly gatewayPort?: number;
  readonly dryRun?: boolean;
  readonly onProgress?: ApplyProgressCallback;
}

/** Progress event during apply. */
export interface ApplyProgress {
  readonly step: "read" | "compile" | "proxy" | "diff" | "write";
  readonly status: "running" | "done" | "failed";
  readonly message: string;
}

export type ApplyProgressCallback = (event: ApplyProgress) => void;

/** Result of the apply operation. */
export interface ApplyResult {
  readonly success: boolean;
  readonly error?: string;
  readonly report: ApplyReport;
}

/** What changed during apply. */
export interface ApplyReport {
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly unchanged: readonly string[];
  readonly skipped: readonly string[];
}

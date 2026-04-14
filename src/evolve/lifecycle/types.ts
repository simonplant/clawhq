/**
 * Types for export + destroy lifecycle operations.
 *
 * Export produces a self-contained portable bundle with PII masking.
 * Destroy wipes all local data and produces a deletion receipt.
 */

// ── Export ──────────────────────────────────────────────────────────────────

/** Pipeline steps for export progress reporting. */
export type ExportStep = "collect" | "mask" | "bundle" | "verify";

/** Pipeline steps for destroy progress reporting. */
export type DestroyStep = "stop" | "inventory" | "wipe" | "verify";

/** Status of a pipeline step. */
export type StepStatus = "running" | "done" | "failed" | "skipped";

/** Progress event for export/destroy operations. */
export interface LifecycleProgress {
  readonly step: ExportStep | DestroyStep;
  readonly status: StepStatus;
  readonly message: string;
}

/** Callback for step-by-step progress reporting. */
export type LifecycleProgressCallback = (progress: LifecycleProgress) => void;

/** Options for portable export. */
export interface ExportOptions {
  /** Path to the deployment directory (default: ~/.clawhq). */
  readonly deployDir: string;
  /** Output file path for the bundle. Auto-generated if not provided. */
  readonly output?: string;
  /** Progress callback for step-by-step reporting. */
  readonly onProgress?: LifecycleProgressCallback;
}

/** Result of a portable export operation. */
export interface ExportResult {
  readonly success: boolean;
  /** Absolute path to the exported bundle file. */
  readonly bundlePath?: string;
  /** Number of files included in the bundle. */
  readonly fileCount?: number;
  /** Total size of the bundle in bytes. */
  readonly bundleSize?: number;
  /** Number of PII instances masked. */
  readonly piiMasked?: number;
  readonly error?: string;
}

// ── PII Masking ────────────────────────────────────────────────────────────

/** Category of PII detected and masked. */
export type PiiCategory = "email" | "phone" | "ssn" | "credit_card" | "ip_address" | "api_key";

/** A single PII detection in a file. */
export interface PiiMatch {
  readonly category: PiiCategory;
  readonly file: string;
  readonly line: number;
  /** The masked replacement (never the original value). */
  readonly replacement: string;
}

/** Summary of PII masking across an export. */
export interface PiiMaskReport {
  readonly totalMasked: number;
  readonly byCategory: Readonly<Record<PiiCategory, number>>;
  readonly files: readonly string[];
}

// ── Destroy ────────────────────────────────────────────────────────────────

/** Options for verified destruction. */
export interface DestroyOptions {
  /** Path to the deployment directory (default: ~/.clawhq). */
  readonly deployDir: string;
  /** Skip confirmation prompt. */
  readonly confirm?: boolean;
  /** Progress callback for step-by-step reporting. */
  readonly onProgress?: LifecycleProgressCallback;
}

/** A file that was destroyed. */
export interface DestroyedFile {
  /** Relative path from the deployment directory. */
  readonly path: string;
  /** Size in bytes before destruction. */
  readonly sizeBefore: number;
}

/** Deletion receipt — records what was destroyed and when. */
export interface DeletionReceipt {
  readonly version: 1;
  /** ISO 8601 timestamp of destruction. */
  readonly destroyedAt: string;
  /** Deployment directory that was destroyed. */
  readonly deployDir: string;
  /** Every file that was destroyed. */
  readonly files: readonly DestroyedFile[];
  /** Total bytes wiped. */
  readonly totalBytes: number;
}

/** Result of a destruction operation. */
export interface DestroyResult {
  readonly success: boolean;
  /** Path to the receipt file (written outside the destroyed directory). */
  readonly receiptPath?: string;
  /** The deletion receipt. */
  readonly receipt?: DeletionReceipt;
  readonly error?: string;
}

/**
 * Types for export + destroy lifecycle operations.
 *
 * Export produces a self-contained portable bundle with PII masking.
 * Destroy wipes all local data with cryptographic proof of destruction.
 */

// ── Export ──────────────────────────────────────────────────────────────────

/** Pipeline steps for export progress reporting. */
export type ExportStep = "collect" | "mask" | "bundle" | "verify";

/** Pipeline steps for destroy progress reporting. */
export type DestroyStep = "stop" | "inventory" | "wipe" | "verify" | "proof";

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

/** A file that was destroyed, with its pre-destruction hash. */
export interface DestroyedFile {
  /** Relative path from the deployment directory. */
  readonly path: string;
  /** SHA-256 hash of the file before destruction. */
  readonly hashBefore: string;
  /** Size in bytes before destruction. */
  readonly sizeBefore: number;
}

/**
 * Cryptographic proof of destruction.
 *
 * Contains a hash manifest of every file that was destroyed, signed
 * with a one-time HMAC key. The proof can be independently verified:
 * the witness hash covers the entire manifest, so any missing file
 * or altered entry invalidates the proof.
 */
export interface DestructionProof {
  readonly version: 1;
  /** ISO 8601 timestamp of destruction. */
  readonly destroyedAt: string;
  /** Deployment directory that was destroyed. */
  readonly deployDir: string;
  /** Every file that was destroyed with its pre-destruction hash. */
  readonly files: readonly DestroyedFile[];
  /** Total bytes wiped. */
  readonly totalBytes: number;
  /** SHA-256 witness hash over the sorted file manifest. */
  readonly witnessHash: string;
  /** HMAC-SHA256 of the witness hash using a one-time key. */
  readonly hmacSignature: string;
  /** The one-time HMAC key (included so anyone can verify). */
  readonly hmacKey: string;
}

/** Result of a verified destruction operation. */
export interface DestroyResult {
  readonly success: boolean;
  /** Path to the proof file (written outside the destroyed directory). */
  readonly proofPath?: string;
  /** The destruction proof object. */
  readonly proof?: DestructionProof;
  readonly error?: string;
}

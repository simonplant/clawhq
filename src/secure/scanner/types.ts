/**
 * Types for PII + secrets scanner.
 *
 * Surfaces API keys, passwords, tokens, and PII in workspace files before
 * deploy. False positives must not train users to ignore scan results.
 */

// ── Finding Categories ──────────────────────────────────────────────────────

/** Categories of secrets and PII the scanner detects. */
export type FindingCategory =
  | "api-key"
  | "password"
  | "token"
  | "private-key"
  | "pii-email"
  | "pii-phone"
  | "pii-ssn"
  | "pii-credit-card"
  | "connection-string"
  | "generic-secret";

/** Severity of a scanner finding. */
export type FindingSeverity = "critical" | "high" | "medium" | "low";

// ── Finding ─────────────────────────────────────────────────────────────────

/** A single secret or PII match found in a file or git commit. */
export interface Finding {
  /** Category of the finding. */
  readonly category: FindingCategory;
  /** Severity level. */
  readonly severity: FindingSeverity;
  /** Human-readable description of what was found. */
  readonly description: string;
  /** File path relative to scan root. */
  readonly file: string;
  /** Line number (1-based). Absent for git history findings. */
  readonly line?: number;
  /** The redacted match value (e.g. "sk-proj-****abcd"). */
  readonly redacted: string;
  /** Source: filesystem scan or git history. */
  readonly source: "file" | "git";
  /** Git commit hash, present only for git history findings. */
  readonly commit?: string;
}

// ── Scan Report ─────────────────────────────────────────────────────────────

/** Aggregate result from a scan run. */
export interface ScanReport {
  /** Timestamp of the scan (ISO 8601). */
  readonly timestamp: string;
  /** Root directory that was scanned. */
  readonly scanRoot: string;
  /** All findings. */
  readonly findings: readonly Finding[];
  /** Findings from file system scan. */
  readonly fileFindings: readonly Finding[];
  /** Findings from git history scan. */
  readonly gitFindings: readonly Finding[];
  /** Number of files scanned. */
  readonly filesScanned: number;
  /** Number of git commits scanned. */
  readonly commitsScanned: number;
  /** True when zero findings. */
  readonly clean: boolean;
}

// ── Options ─────────────────────────────────────────────────────────────────

/** Options for running a scan. */
export interface ScanOptions {
  /** Path to the deployment directory (default: ~/.clawhq). */
  readonly deployDir: string;
  /** Scan git history for committed secrets. */
  readonly git?: boolean;
  /** Maximum git commits to scan (default: 100). */
  readonly maxCommits?: number;
  /** Output format. */
  readonly format?: "table" | "json";
  /** AbortSignal for cancellation. */
  readonly signal?: AbortSignal;
}

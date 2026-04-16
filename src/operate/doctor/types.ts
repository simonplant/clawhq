/**
 * Types for doctor diagnostics and auto-fix.
 *
 * Doctor is the hero feature — 14+ preventive checks that catch every known
 * failure mode before it hits the user. Auto-fix resolves common issues
 * without requiring knowledge of internals.
 */

// ── Check Names ─────────────────────────────────────────────────────────────

/** All diagnostic check names. Each maps to one failure mode. */
export type DoctorCheckName =
  | "config-exists"
  | "config-valid"
  | "compose-exists"
  | "secrets-perms"
  | "creds-perms"
  | "docker-running"
  | "container-running"
  | "cap-drop"
  | "no-new-privileges"
  | "user-uid"
  | "identity-size"
  | "cron-schema"
  | "cron-syntax"
  | "cron-health"
  | "env-vars"
  | "firewall-active"
  | "workspace-exists"
  | "gateway-reachable"
  | "disk-space"
  | "air-gap-active"
  | "tool-access-grants"
  | "migration-state"
  | "underscore-tool-methods"
  | "onepassword-setup"
  | "sanitize-available"
  | "ipset-egress-current"
  | "ops-autoupdate-active"
  | "ops-backup-recent"
  | "ops-security-monitor"
  | "cred-proxy-healthy"
  | "egress-domains-coverage"
  | "ollama-reachable"
  | "ollama-model-available"
  | "config-sync"
  | "ollama-url";

// ── Check Result ────────────────────────────────────────────────────────────

/** Severity of a diagnostic finding. */
export type DoctorSeverity = "error" | "warning" | "info";

/** Result of a single doctor check. */
export interface DoctorCheckResult {
  /** Check identifier. */
  readonly name: DoctorCheckName;
  /** Whether the check passed. */
  readonly passed: boolean;
  /** Severity when check fails. */
  readonly severity: DoctorSeverity;
  /** Human-readable status message. */
  readonly message: string;
  /** Actionable fix suggestion when check fails. */
  readonly fix?: string;
  /** Whether this check supports auto-fix via --fix. */
  readonly fixable?: boolean;
}

// ── Report ──────────────────────────────────────────────────────────────────

/** Aggregate result from running all doctor checks. */
export interface DoctorReport {
  /** Timestamp of the doctor run (ISO 8601). */
  readonly timestamp: string;
  /** All check results. */
  readonly checks: readonly DoctorCheckResult[];
  /** Checks that passed. */
  readonly passed: readonly DoctorCheckResult[];
  /** Checks that failed with error severity. */
  readonly errors: readonly DoctorCheckResult[];
  /** Checks that failed with warning severity. */
  readonly warnings: readonly DoctorCheckResult[];
  /** True when zero errors. */
  readonly healthy: boolean;
}

// ── Fix Result ──────────────────────────────────────────────────────────────

/** Result of an auto-fix attempt. */
export interface FixResult {
  /** Which check was fixed. */
  readonly name: DoctorCheckName;
  /** Whether the fix succeeded. */
  readonly success: boolean;
  /** What was done or why it failed. */
  readonly message: string;
}

/** Aggregate result from running auto-fixes. */
export interface FixReport {
  /** Individual fix results. */
  readonly fixes: readonly FixResult[];
  /** Number of successful fixes. */
  readonly fixed: number;
  /** Number of failed fix attempts. */
  readonly failed: number;
}

// ── Options ─────────────────────────────────────────────────────────────────

/** Options for running doctor diagnostics. */
export interface DoctorOptions {
  /** Path to the deployment directory (default: ~/.clawhq). */
  readonly deployDir: string;
  /** Run auto-fix for fixable issues. */
  readonly fix?: boolean;
  /** Output format. */
  readonly format?: "table" | "json";
  /** AbortSignal for cancellation. */
  readonly signal?: AbortSignal;
}

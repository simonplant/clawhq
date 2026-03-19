/**
 * Types for the audit trail system.
 *
 * Three event streams, each append-only JSONL:
 *   - Tool execution: what the agent did
 *   - Egress: what data left the machine
 *   - Secret lifecycle: credential added/rotated/revoked (HMAC-chained)
 */

// ── Common ─────────────────────────────────────────────────────────────────

/** Base fields shared by all audit events. */
export interface AuditEventBase {
  /** ISO 8601 timestamp. */
  readonly ts: string;
  /** Monotonic sequence number within the log file. */
  readonly seq: number;
}

// ── Tool Execution ─────────────────────────────────────────────────────────

/** Logged when a tool is executed by the agent. */
export interface ToolExecutionEvent extends AuditEventBase {
  readonly type: "tool_execution";
  /** Tool name (e.g. "email", "web-search", "tasks"). */
  readonly tool: string;
  /** What the tool was asked to do (truncated). */
  readonly action: string;
  /** Exit status: success, failure, timeout. */
  readonly status: "success" | "failure" | "timeout";
  /** Execution duration in milliseconds. */
  readonly durationMs: number;
  /** Error message if status is failure/timeout. */
  readonly error?: string;
}

// ── Egress ─────────────────────────────────────────────────────────────────

/** Logged when data leaves the machine. */
export interface EgressEvent extends AuditEventBase {
  readonly type: "egress";
  /** Destination domain or IP. */
  readonly destination: string;
  /** Protocol (https, smtp, etc.). */
  readonly protocol: string;
  /** Approximate bytes sent. */
  readonly bytesSent: number;
  /** Which integration triggered this egress. */
  readonly integration: string;
  /** Whether the egress was allowed or blocked by the firewall. */
  readonly allowed: boolean;
}

// ── Secret Lifecycle ───────────────────────────────────────────────────────

/** Secret lifecycle action. */
export type SecretAction = "added" | "rotated" | "revoked" | "accessed";

/** HMAC-chained event for tamper-evident secret lifecycle tracking. */
export interface SecretLifecycleEvent extends AuditEventBase {
  readonly type: "secret_lifecycle";
  /** Secret identifier (key name, never the value). */
  readonly secretId: string;
  /** What happened. */
  readonly action: SecretAction;
  /** Who/what triggered this event. */
  readonly actor: string;
  /** HMAC of this event chained with the previous event's HMAC. */
  readonly hmac: string;
  /** HMAC of the previous event (empty string for the first event). */
  readonly prevHmac: string;
}

/** Union of all audit event types. */
export type AuditEvent = ToolExecutionEvent | EgressEvent | SecretLifecycleEvent;

// ── Config ─────────────────────────────────────────────────────────────────

/** Paths for the three audit log files. */
export interface AuditTrailConfig {
  /** Path to tool execution JSONL log. */
  readonly toolLogPath: string;
  /** Path to egress JSONL log. */
  readonly egressLogPath: string;
  /** Path to secret lifecycle JSONL log. */
  readonly secretLogPath: string;
  /** HMAC secret key for chaining secret lifecycle events. */
  readonly hmacKey: string;
}

// ── Report ─────────────────────────────────────────────────────────────────

/** Summary of recent audit activity. */
export interface AuditReport {
  readonly timestamp: string;
  readonly toolExecutions: readonly ToolExecutionEvent[];
  readonly egressEvents: readonly EgressEvent[];
  readonly secretEvents: readonly SecretLifecycleEvent[];
  readonly summary: AuditSummary;
}

/** Aggregated counts for the audit report. */
export interface AuditSummary {
  readonly totalToolExecutions: number;
  readonly successfulExecutions: number;
  readonly failedExecutions: number;
  readonly totalEgressEvents: number;
  readonly allowedEgress: number;
  readonly blockedEgress: number;
  readonly totalSecretEvents: number;
  readonly chainValid: boolean;
}

// ── OWASP Export ───────────────────────────────────────────────────────────

/** OWASP-compatible audit export envelope. */
export interface OwaspExport {
  readonly version: "1.0";
  readonly generator: "clawhq";
  readonly generatedAt: string;
  readonly metadata: {
    readonly deployDir: string;
    readonly period: { readonly from: string; readonly to: string };
  };
  readonly events: readonly OwaspEvent[];
}

/** Normalized event for OWASP export. */
export interface OwaspEvent {
  readonly timestamp: string;
  readonly category: "tool-execution" | "data-egress" | "secret-lifecycle";
  readonly action: string;
  readonly outcome: "success" | "failure" | "blocked";
  readonly actor: string;
  readonly target: string;
  readonly details: Record<string, unknown>;
}

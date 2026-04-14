/**
 * Types for the audit trail system.
 *
 * Four event streams, each append-only JSONL:
 *   - Tool execution: what the agent did
 *   - Egress: what data left the machine
 *   - Secret lifecycle: credential added/rotated/revoked
 *   - Approval resolution: high-stakes action approved/rejected by user
 */

// ── Common ─────────────────────────────────────────────────────────────────

/** Base fields shared by all audit events. */
export interface AuditEventBase {
  /** ISO 8601 timestamp. */
  readonly ts: string;
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

/** Secret lifecycle event. */
export interface SecretLifecycleEvent extends AuditEventBase {
  readonly type: "secret_lifecycle";
  /** Secret identifier (key name, never the value). */
  readonly secretId: string;
  /** What happened. */
  readonly action: SecretAction;
  /** Who/what triggered this event. */
  readonly actor: string;
}

// ── Approval Resolution ──────────────────────────────────────────────────

/** Logged when a high-stakes action is approved or rejected by the user. */
export interface ApprovalResolutionEvent extends AuditEventBase {
  readonly type: "approval_resolution";
  /** Approval item ID. */
  readonly itemId: string;
  /** Category of action (send_email, purchase, delete, etc.). */
  readonly category: string;
  /** Human-readable summary of the proposed action. */
  readonly summary: string;
  /** Resolution: approved or rejected. */
  readonly resolution: "approved" | "rejected";
  /** How the resolution was delivered (cli, telegram). */
  readonly resolvedVia: string;
  /** Source skill that generated the proposal. */
  readonly source: string;
}

/** Union of all audit event types. */
export type AuditEvent = ToolExecutionEvent | EgressEvent | SecretLifecycleEvent | ApprovalResolutionEvent;

// ── Config ─────────────────────────────────────────────────────────────────

/** Paths for the four audit log files. */
export interface AuditTrailConfig {
  /** Path to tool execution JSONL log. */
  readonly toolLogPath: string;
  /** Path to egress JSONL log. */
  readonly egressLogPath: string;
  /** Path to secret lifecycle JSONL log. */
  readonly secretLogPath: string;
  /** Path to approval resolution JSONL log. */
  readonly approvalLogPath: string;
}

// ── Report ─────────────────────────────────────────────────────────────────

/** Summary of recent audit activity. */
export interface AuditReport {
  readonly timestamp: string;
  readonly toolExecutions: readonly ToolExecutionEvent[];
  readonly egressEvents: readonly EgressEvent[];
  readonly secretEvents: readonly SecretLifecycleEvent[];
  readonly approvalEvents: readonly ApprovalResolutionEvent[];
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
  readonly totalApprovalEvents: number;
  readonly approvedCount: number;
  readonly rejectedCount: number;
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
  readonly category: "tool-execution" | "data-egress" | "secret-lifecycle" | "approval-resolution";
  readonly action: string;
  readonly outcome: "success" | "failure" | "blocked";
  readonly actor: string;
  readonly target: string;
  readonly details: Record<string, unknown>;
}

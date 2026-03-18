/**
 * Tool execution audit trail types.
 *
 * Defines the shape of entries in the local JSONL audit log
 * (~/.clawhq/audit.jsonl). Distinct from egress audit which
 * covers outbound network calls only — this covers all tool
 * invocations including local tools (tasks, calendar, email).
 */

/** A single tool execution audit entry. */
export interface AuditEntry {
  /** ISO 8601 timestamp of the tool invocation. */
  timestamp: string;
  /** Gateway session ID (if available). */
  sessionId?: string;
  /** Name of the tool that was executed. */
  toolName: string;
  /** Tool inputs with sensitive fields redacted. */
  redactedInputs: Record<string, unknown>;
  /** Summarized output (max 200 chars). */
  summarizedOutput: string;
  /** Execution duration in milliseconds. */
  durationMs: number;
}

/** Options for querying the audit log. */
export interface AuditQueryOptions {
  /** Only include entries since this date (ISO 8601). */
  since?: string;
  /** Filter by tool name. */
  toolName?: string;
  /** Maximum number of entries to return. */
  limit?: number;
}

/** OWASP GenAI Top 10 compliance report. */
export interface ComplianceReport {
  /** Report generation timestamp. */
  generatedAt: string;
  /** Period covered. */
  since: string | null;
  until: string;
  /** Total tool executions in period. */
  totalExecutions: number;
  /** Execution counts by tool name. */
  byTool: Record<string, number>;
  /** Data categories accessed (inferred from tool names). */
  dataCategoriesAccessed: string[];
  /** Average execution duration in ms. */
  avgDurationMs: number;
  /** OWASP GenAI Top 10 control assessments. */
  controls: ComplianceControl[];
}

/** A single OWASP GenAI Top 10 control assessment. */
export interface ComplianceControl {
  /** Control ID (e.g. "LLM01"). */
  id: string;
  /** Control name. */
  name: string;
  /** Assessment status. */
  status: "pass" | "warn" | "info";
  /** Finding description. */
  finding: string;
}

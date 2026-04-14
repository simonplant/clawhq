/**
 * Audit trail module — tool execution, egress, secret lifecycle, and approval logging.
 *
 * Four append-only JSONL streams for debugging and compliance reporting.
 * OWASP-compatible export for compliance reporting.
 */

// Types
export type {
  ApprovalResolutionEvent,
  AuditEvent,
  AuditReport,
  AuditSummary,
  AuditTrailConfig,
  EgressEvent,
  OwaspEvent,
  OwaspExport,
  SecretAction,
  SecretLifecycleEvent,
  ToolExecutionEvent,
} from "./types.js";

// Logger
export {
  createAuditConfig,
  logApprovalResolution,
  logEgressEvent,
  logSecretEvent,
  logToolExecution,
} from "./logger.js";

// Reader
export { readAuditReport } from "./reader.js";
export type { ReadAuditOptions } from "./reader.js";

// OWASP export
export { buildOwaspExport } from "./owasp.js";

// Formatters
export { formatAuditJson, formatAuditTable } from "./format.js";

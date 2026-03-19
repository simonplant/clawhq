/**
 * Audit trail module — tool execution, egress, and secret lifecycle logging.
 *
 * Three append-only JSONL streams with HMAC-chained secret events for
 * tamper-evident audit. OWASP-compatible export for compliance reporting.
 */

// Types
export type {
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
  initHmacChain,
  initSeqCounter,
  logEgressEvent,
  logSecretEvent,
  logToolExecution,
} from "./logger.js";

// Reader
export { readAuditReport, verifyHmacChain } from "./reader.js";
export type { ReadAuditOptions } from "./reader.js";

// OWASP export
export { buildOwaspExport } from "./owasp.js";

// Formatters
export { formatAuditJson, formatAuditTable } from "./format.js";

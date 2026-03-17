/**
 * Audit module.
 *
 * Provides two audit subsystems:
 * - Egress audit (`clawhq audit --egress`): outbound API calls and blocked packets
 * - Tool execution audit (`clawhq audit`): all tool invocations with redacted inputs
 */

// ── Egress audit ───────────────────────────────────────────────────

export {
  collectEgressAudit,
  parseDropLog,
  parseEgressLog,
} from "./egress.js";

export type {
  DropEntry,
  EgressAuditOptions,
  EgressAuditReport,
  EgressAuditSummary,
  EgressEntry,
  ProviderSummary,
} from "./egress.js";

export {
  formatEgressAuditJson,
  formatEgressAuditTable,
  generateExportReport,
  generateZeroEgressAttestation,
} from "./format.js";

// ── Tool execution audit ───────────────────────────────────────────

export {
  appendToolAudit,
  collectToolAudit,
  readToolAuditLog,
  redactSecrets,
  resolveLogPath,
  TOOL_AUDIT_FILENAME,
} from "./tool-trail.js";

export type {
  ToolAuditEntry,
  ToolAuditReadOptions,
  ToolAuditReport,
  ToolAuditSummary,
  ToolSummary,
} from "./tool-trail.js";

export {
  formatToolAuditJson,
  formatToolAuditTable,
  generateComplianceReport,
  generateToolExportReport,
} from "./tool-format.js";

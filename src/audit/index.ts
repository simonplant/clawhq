/**
 * Egress audit module.
 *
 * Provides `clawhq audit --egress` functionality:
 * detailed view of all outbound API calls and blocked packets.
 */

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

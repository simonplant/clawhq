// Health self-repair (auto-recovery).
// See docs/PRODUCT.md → Health self-repair.

export { repairIssue, reapplyFirewall, reconnectNetwork, restartGateway } from "./actions.js";
export { logRepairAction, readRepairLog } from "./logger.js";
export { checkFirewall, checkGateway, checkNetwork, detectIssues } from "./monitor.js";
export { formatRepairJson, formatRepairReport, runRepair } from "./runner.js";

export type {
  DetectedIssue,
  IssueType,
  RepairActionResult,
  RepairConfig,
  RepairContext,
  RepairLogEntry,
  RepairReport,
  RepairStatus,
} from "./types.js";

export { DEFAULT_REPAIR_CONFIG } from "./types.js";

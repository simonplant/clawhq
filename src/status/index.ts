/**
 * Status dashboard module.
 *
 * Public API for collecting and formatting the agent status dashboard.
 */

export type {
  AgentState,
  AgentStatus,
  EgressPeriod,
  EgressSummary,
  IdentityFile,
  IntegrationHealth,
  IntegrationSection,
  IntegrationStatus,
  MemoryTier,
  OpenClawSourceStatus,
  StatusOptions,
  StatusReport,
  WorkspaceMetrics,
} from "./types.js";

export { collectAgentStatus } from "./agent.js";
export { collectStatus } from "./collector.js";
export { collectEgressSummary } from "./egress.js";
export { formatDashboard, formatJson } from "./format.js";
export { collectIntegrationHealth } from "./integrations.js";
export { collectWorkspaceMetrics } from "./workspace.js";

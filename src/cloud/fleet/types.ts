/**
 * Fleet management types.
 *
 * Defines the shape of fleet-wide reports: per-agent status, aggregated
 * health/cost/security views, and fleet-wide doctor diagnostics.
 */

import type { DoctorReport } from "../../operate/doctor/types.js";
import type { AgentStatus, EgressSummary, IntegrationSection, WorkspaceMetrics } from "../../operate/status/types.js";

// --- Agent discovery ---

export interface FleetAgent {
  /** Agent ID from config. */
  id: string;
  /** Workspace path. */
  workspace: string;
  /** Whether this is the default agent. */
  isDefault: boolean;
  /** OpenClaw home directory for this agent. */
  openclawHome: string;
}

// --- Per-agent status ---

export interface FleetAgentStatus {
  agent: FleetAgent;
  status: AgentStatus;
  integrations: IntegrationSection;
  workspace: WorkspaceMetrics;
  egress: EgressSummary;
  error?: string;
}

// --- Aggregated fleet views ---

export interface FleetHealthSummary {
  total: number;
  running: number;
  stopped: number;
  degraded: number;
  unknown: number;
}

export interface FleetCostSummary {
  totalEgressBytes: number;
  totalEgressCalls: number;
  zeroEgressCount: number;
  perAgent: Array<{
    agentId: string;
    egressBytes: number;
    egressCalls: number;
    zeroEgress: boolean;
  }>;
}

export interface FleetSecuritySummary {
  totalIntegrations: number;
  validCount: number;
  failingCount: number;
  perAgent: Array<{
    agentId: string;
    valid: number;
    failing: number;
    total: number;
  }>;
}

// --- Fleet report ---

export interface FleetReport {
  timestamp: string;
  agents: FleetAgentStatus[];
  health: FleetHealthSummary;
  cost: FleetCostSummary;
  security: FleetSecuritySummary;
}

// --- Fleet doctor ---

export interface FleetDoctorEntry {
  agentId: string;
  report: DoctorReport;
  error?: string;
}

export interface FleetDoctorReport {
  timestamp: string;
  entries: FleetDoctorEntry[];
  allPassed: boolean;
  totals: { pass: number; warn: number; fail: number };
}

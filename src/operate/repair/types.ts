/**
 * Health self-repair types.
 *
 * Defines interfaces for the repair module: monitors detect issues,
 * actions perform recovery, and a runner orchestrates both.
 */

// --- Repair behaviors (configurable per-behavior) ---

export interface RepairConfig {
  /** Auto-restart container on Gateway crash. */
  gatewayRestart: boolean;
  /** Auto-reconnect on network drop. */
  networkReconnect: boolean;
  /** Auto-reapply firewall on bridge interface change. */
  firewallReapply: boolean;
}

export const DEFAULT_REPAIR_CONFIG: RepairConfig = {
  gatewayRestart: true,
  networkReconnect: true,
  firewallReapply: true,
};

// --- Monitor results ---

export type IssueType = "gateway_down" | "network_drop" | "firewall_missing";

export interface DetectedIssue {
  type: IssueType;
  message: string;
  detectedAt: string;
}

// --- Repair actions ---

export type RepairStatus = "repaired" | "failed" | "skipped";

export interface RepairActionResult {
  issue: IssueType;
  status: RepairStatus;
  action: string;
  message: string;
  durationMs: number;
}

// --- Repair context ---

export interface RepairContext {
  openclawHome: string;
  configPath: string;
  composePath?: string;
  envPath?: string;
  imageTag?: string;
  gatewayHost?: string;
  gatewayPort?: number;
  enabledProviders?: string[];
  extraDomains?: string[];
  bridgeInterface?: string;
  signal?: AbortSignal;
}

// --- Repair report ---

export interface RepairReport {
  issues: DetectedIssue[];
  actions: RepairActionResult[];
  allHealthy: boolean;
}

// --- Audit log entry ---

export interface RepairLogEntry {
  timestamp: string;
  issue: IssueType;
  action: string;
  status: RepairStatus;
  message: string;
  durationMs: number;
}

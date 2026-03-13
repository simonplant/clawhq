/**
 * Status dashboard types.
 *
 * Defines the shape of the status report: agent state, integration health,
 * workspace metrics, and data egress summary.
 */

// --- Agent state ---

export type AgentState = "running" | "stopped" | "degraded" | "unknown";

export interface AgentStatus {
  state: AgentState;
  containerId?: string;
  containerName?: string;
  image?: string;
  uptime?: string;
  gatewayStatus: "up" | "down" | "degraded";
  gatewayLatencyMs?: number;
}

// --- Integration health ---

export type IntegrationStatus = "valid" | "expired" | "failing" | "error" | "missing";

export interface IntegrationHealth {
  provider: string;
  status: IntegrationStatus;
  message: string;
}

export interface IntegrationSection {
  integrations: IntegrationHealth[];
  counts: Record<IntegrationStatus, number>;
}

// --- Workspace metrics ---

export interface MemoryTier {
  tier: string;
  path: string;
  sizeBytes: number;
  fileCount: number;
}

export interface IdentityFile {
  name: string;
  path: string;
  sizeBytes: number;
  estimatedTokens: number;
}

export interface WorkspaceMetrics {
  memoryTiers: MemoryTier[];
  identityFiles: IdentityFile[];
  totalMemoryBytes: number;
  totalIdentityTokens: number;
}

// --- Data egress ---

export interface EgressPeriod {
  label: string;
  bytes: number;
  calls: number;
}

export interface EgressSummary {
  today: EgressPeriod;
  week: EgressPeriod;
  month: EgressPeriod;
  zeroEgress: boolean;
}

// --- Channel health ---

export type ChannelConnectionStatus = "connected" | "disconnected" | "error" | "unconfigured";

export interface ChannelHealthEntry {
  channel: string;
  status: ChannelConnectionStatus;
  message: string;
  displayName?: string;
}

// --- Full status report ---

export interface StatusReport {
  timestamp: string;
  agent: AgentStatus;
  integrations: IntegrationSection;
  channels: ChannelHealthEntry[];
  workspace: WorkspaceMetrics;
  egress: EgressSummary;
}

export interface StatusOptions {
  /** OpenClaw home directory (default: ~/.openclaw). */
  openclawHome?: string;
  /** Path to .env file for credential probes. */
  envPath?: string;
  /** Gateway host (default: 127.0.0.1). */
  gatewayHost?: string;
  /** Gateway port (default: 18789). */
  gatewayPort?: number;
  /** Path to docker-compose.yml. */
  composePath?: string;
  /** Path to egress log file. */
  egressLogPath?: string;
}

/**
 * Types for the cloud module — trust modes, heartbeat, and command queue.
 *
 * Three trust modes (paranoid, zero-trust, managed) control what the cloud
 * layer can do. Heartbeat reports health outbound. Command queue receives
 * signed commands that are verified before execution.
 */

import type { TrustMode } from "../config/types.js";

// ── Trust Mode State ─────────────────────────────────────────────────────────

/** Persisted trust mode state at ~/.clawhq/cloud/trust-mode.json. */
export interface TrustModeState {
  readonly version: 1;
  /** Current trust mode. */
  readonly mode: TrustMode;
  /** Whether cloud connection is active. */
  readonly connected: boolean;
  /** ISO 8601 timestamp of last mode change. */
  readonly changedAt: string;
  /** ISO 8601 timestamp of when cloud was connected (if ever). */
  readonly connectedAt?: string;
  /** ISO 8601 timestamp of when cloud was disconnected (if ever). */
  readonly disconnectedAt?: string;
}

/** Result of switching trust mode. */
export interface SwitchModeResult {
  readonly success: boolean;
  readonly previousMode: TrustMode;
  readonly currentMode: TrustMode;
  readonly error?: string;
}

/** Result of disconnecting from cloud. */
export interface DisconnectResult {
  readonly success: boolean;
  readonly wasConnected: boolean;
  readonly error?: string;
}

// ── Command Classification ───────────────────────────────────────────────────

/** Cloud command types that can be sent via the command queue. */
export type CloudCommandType =
  | "health-check"
  | "update-notify"
  | "security-advisory"
  | "trigger-update"
  | "trigger-backup"
  | "restart-agent"
  | "apply-config-patch"
  | "read-health-status"
  | "read-operational-metrics"
  // Architecturally blocked — no handler exists (AD-05)
  | "read-memory-contents"
  | "read-conversations"
  | "read-credential-values"
  | "read-identity-files"
  | "shell-access";

/** How a command is handled in a given trust mode. */
export type CommandDisposition = "allowed" | "approval" | "auto" | "blocked";

// ── Command Queue ────────────────────────────────────────────────────────────

/** A signed command from the cloud. */
export interface SignedCommand {
  /** Unique command ID. */
  readonly id: string;
  /** Command type. */
  readonly type: CloudCommandType;
  /** Optional payload (config patch, update version, etc.). */
  readonly payload?: Record<string, unknown>;
  /** ISO 8601 timestamp of when the command was created. */
  readonly createdAt: string;
  /** Ed25519 signature over `id + type + createdAt + JSON(payload)`. */
  readonly signature: string;
}

/** Result of verifying a command signature. */
export interface VerifyResult {
  readonly valid: boolean;
  readonly reason?: string;
}

/** Result of executing a command. */
export interface CommandResult {
  readonly commandId: string;
  readonly type: CloudCommandType;
  readonly disposition: CommandDisposition;
  readonly executed: boolean;
  readonly error?: string;
  readonly timestamp: string;
}

/** Persisted command queue state at ~/.clawhq/cloud/commands.json. */
export interface CommandQueueState {
  readonly version: 1;
  readonly pending: readonly SignedCommand[];
  readonly history: readonly CommandResult[];
}

// ── Heartbeat ────────────────────────────────────────────────────────────────

/** Health report sent outbound during heartbeat. Never includes content. */
export interface HealthReport {
  /** Agent identifier (deployment directory hash). */
  readonly agentId: string;
  /** Current trust mode. */
  readonly trustMode: TrustMode;
  /** Whether the container is running. */
  readonly containerRunning: boolean;
  /** Container uptime in seconds (-1 if not running). */
  readonly uptimeSeconds: number;
  /** Integration count (not names or credentials). */
  readonly integrationCount: number;
  /** Memory tier sizes in bytes (not contents). */
  readonly memoryTierSizes: {
    readonly hot: number;
    readonly warm: number;
    readonly cold: number;
  };
  /** Disk usage percentage. */
  readonly diskUsagePercent: number;
  /** ISO 8601 timestamp. */
  readonly timestamp: string;
}

/** Persisted heartbeat state at ~/.clawhq/cloud/heartbeat.json. */
export interface HeartbeatState {
  readonly version: 1;
  /** ISO 8601 timestamp of last successful heartbeat. */
  readonly lastSentAt?: string;
  /** Number of consecutive failures. */
  readonly consecutiveFailures: number;
  /** Last error message if any. */
  readonly lastError?: string;
}

/** Result of a heartbeat attempt. */
export interface HeartbeatResult {
  readonly success: boolean;
  readonly report?: HealthReport;
  readonly error?: string;
  readonly timestamp: string;
}

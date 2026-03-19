/**
 * Types for the status dashboard.
 *
 * `clawhq status [--watch]` shows a single-pane view of agent state:
 * container health, gateway reachability, config validity, resource usage.
 */

// ── Status Sections ─────────────────────────────────────────────────────────

/** Agent container state from Docker. */
export interface ContainerStatus {
  readonly running: boolean;
  readonly name: string;
  readonly image: string;
  readonly state: string;
  readonly health: string;
  /** Uptime string (e.g. "2 hours ago"). */
  readonly startedAt: string;
}

/** Gateway reachability. */
export interface GatewayStatus {
  readonly reachable: boolean;
  readonly latencyMs?: number;
  readonly error?: string;
}

/** Disk usage for deployment directory. */
export interface DiskUsage {
  readonly totalMb: number;
  readonly freeMb: number;
  readonly usedPercent: number;
}

/** Aggregate status snapshot. */
export interface StatusSnapshot {
  readonly timestamp: string;
  readonly container: ContainerStatus | null;
  readonly gateway: GatewayStatus;
  readonly configValid: boolean;
  readonly configErrors: readonly string[];
  readonly disk: DiskUsage | null;
  /** Overall agent health. */
  readonly healthy: boolean;
}

// ── Options ─────────────────────────────────────────────────────────────────

/** Options for gathering status. */
export interface StatusOptions {
  readonly deployDir: string;
  readonly signal?: AbortSignal;
}

/** Options for watch mode. */
export interface StatusWatchOptions extends StatusOptions {
  /** Refresh interval in ms (default: 5000). */
  readonly intervalMs?: number;
  /** Callback invoked on each refresh. */
  readonly onUpdate: (snapshot: StatusSnapshot) => void;
}

/**
 * Verified destruction type definitions.
 *
 * Covers the full destruction sequence: dry-run inventory,
 * confirmation, step-by-step teardown, and signed manifest.
 */

export interface DestroyOptions {
  /** OpenClaw home directory (default: ~/.openclaw). */
  openclawHome: string;
  /** Path to docker-compose.yml. */
  composePath?: string;
  /** Agent image tag to remove. */
  imageTag?: string;
  /** Base image tag to remove. */
  baseTag?: string;
  /** Docker bridge interface for firewall removal. */
  bridgeInterface?: string;
  /** ClawHQ config directory (default: ~/.clawhq). */
  clawhqConfigDir?: string;
  /** Preserve export bundle if one exists. */
  keepExport?: boolean;
  /** Deployment name the user must type for confirmation. */
  deploymentName?: string;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

export type StepStatus = "done" | "failed" | "skipped";

export interface DestroyStep {
  name: string;
  status: StepStatus;
  message: string;
  durationMs: number;
}

export interface DryRunItem {
  /** Category of data. */
  category: "container" | "volume" | "workspace" | "config" | "secrets" | "images" | "networks" | "firewall" | "clawhq-config" | "export";
  /** Human-readable label. */
  label: string;
  /** Filesystem path or Docker resource ID. */
  location: string;
  /** Whether ClawHQ can destroy this automatically. */
  autoDestroy: boolean;
  /** If not autoDestroy, what the user must do manually. */
  manualAction?: string;
}

export interface DryRunResult {
  items: DryRunItem[];
  hasBackup: boolean;
  hasExport: boolean;
  deploymentName: string;
}

export interface DestructionManifestEntry {
  step: string;
  status: StepStatus;
  timestamp: string;
  hash?: string;
}

export interface DestructionManifest {
  manifestId: string;
  deploymentName: string;
  destroyedAt: string;
  version: number;
  steps: DestructionManifestEntry[];
  verification: {
    algorithm: string;
    hash: string;
  };
}

export interface DestroyResult {
  success: boolean;
  steps: DestroyStep[];
  manifest?: DestructionManifest;
}

export class DestroyError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DestroyError";
  }
}

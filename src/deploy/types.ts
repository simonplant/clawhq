/**
 * Deploy sequence types.
 *
 * Shared types for the deploy orchestration: pre-flight checks,
 * deploy (up), shutdown (down), and restart commands.
 */

export interface DeployOptions {
  /** Path to docker-compose.yml. */
  composePath?: string;
  /** OpenClaw home directory (default: ~/.openclaw). */
  openclawHome?: string;
  /** Path to openclaw.json. */
  configPath?: string;
  /** Path to .env file. */
  envPath?: string;
  /** Expected agent image tag. */
  imageTag?: string;
  /** Expected base image tag. */
  baseTag?: string;
  /** Health poll timeout in ms (default: 60000). */
  healthTimeoutMs?: number;
  /** Gateway host (default: 127.0.0.1). */
  gatewayHost?: string;
  /** Gateway port (default: 18789). */
  gatewayPort?: number;
  /** Cloud API providers enabled for egress firewall allowlist. */
  enabledProviders?: string[];
  /** Extra domains to allowlist in egress firewall. */
  extraDomains?: string[];
  /** Docker bridge interface for firewall (default: docker0). */
  bridgeInterface?: string;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

export type StepStatus = "running" | "done" | "failed" | "skipped";

export interface StepResult {
  name: string;
  status: StepStatus;
  message: string;
  durationMs: number;
}

export interface PreflightResult {
  passed: boolean;
  steps: StepResult[];
}

export interface DeployResult {
  success: boolean;
  steps: StepResult[];
  /** Container ID if deployment succeeded. */
  containerId?: string;
}

export interface ShutdownResult {
  success: boolean;
  steps: StepResult[];
}

export interface RestartResult {
  success: boolean;
  steps: StepResult[];
  containerId?: string;
}

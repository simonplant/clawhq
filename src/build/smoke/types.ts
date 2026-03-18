/**
 * Smoke test types.
 *
 * Post-deploy verification that the agent is actually working —
 * not just "container healthy but agent broken."
 */

export type SmokeCheckStatus = "pass" | "fail" | "skip";

export interface SmokeCheckResult {
  name: string;
  status: SmokeCheckStatus;
  message: string;
  durationMs: number;
}

export interface SmokeTestResult {
  passed: boolean;
  checks: SmokeCheckResult[];
}

export interface SmokeTestOptions {
  /** OpenClaw home directory (default: ~/.openclaw). */
  openclawHome: string;
  /** Path to openclaw.json. */
  configPath: string;
  /** Gateway host (default: 127.0.0.1). */
  gatewayHost?: string;
  /** Gateway port (default: 18789). */
  gatewayPort?: number;
  /** Gateway auth token. */
  gatewayToken?: string;
  /** Timeout for test message response in ms (default: 30000). */
  responseTimeoutMs?: number;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

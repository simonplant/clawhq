/**
 * Types for deploy orchestration and preflight checks.
 *
 * Covers the full deploy lifecycle: preflight → compose up → firewall →
 * health verify → smoke test. Includes progress reporting and AbortSignal
 * support for the `clawhq up / down / restart` commands.
 */

// ── Preflight Checks ────────────────────────────────────────────────────────

/** Names of the 6 preflight checks. Most block deploy on failure; some are warnings. */
export type PreflightCheckName =
  | "docker"
  | "images"
  | "config"
  | "secrets"
  | "ports"
  | "ollama"
  | "gvisor";

/** Result of a single preflight check. */
export interface PreflightCheckResult {
  readonly name: PreflightCheckName;
  readonly passed: boolean;
  /** Human-readable actionable error when check fails. */
  readonly message: string;
  /** Suggested fix command or action. */
  readonly fix?: string;
  /** When true, check failed but should not block deploy (e.g. Ollama absent). */
  readonly warning?: boolean;
}

/** Aggregate result of all preflight checks. */
export interface PreflightReport {
  /** True when all non-warning checks passed. */
  readonly passed: boolean;
  readonly checks: readonly PreflightCheckResult[];
  /** Checks that hard-failed (blocking). */
  readonly failed: readonly PreflightCheckResult[];
  /** Checks that failed but are non-blocking warnings. */
  readonly warnings: readonly PreflightCheckResult[];
}

// ── Deploy Steps ────────────────────────────────────────────────────────────

/** Named steps in the deploy sequence, reported via progress callback. */
export type DeployStepName =
  | "preflight"
  | "compose-up"
  | "identity-lock"
  | "firewall"
  | "health-verify"
  | "smoke-test";

/** Status of a deploy step. */
export type DeployStepStatus = "running" | "done" | "failed" | "skipped";

/** Progress event emitted during deploy. */
export interface DeployProgress {
  readonly step: DeployStepName;
  readonly status: DeployStepStatus;
  readonly message: string;
}

/** Callback for step-by-step progress reporting. */
export type ProgressCallback = (progress: DeployProgress) => void;

// ── Deploy Options ──────────────────────────────────────────────────────────

/** Options for the deploy (up) command. */
export interface DeployOptions {
  /** Path to the deployment directory (default: ~/.clawhq). */
  readonly deployDir: string;
  /** Gateway auth token for health checks. */
  readonly gatewayToken: string;
  /** Gateway port (default: GATEWAY_DEFAULT_PORT). */
  readonly gatewayPort?: number;
  /** Skip preflight checks (not recommended). */
  readonly skipPreflight?: boolean;
  /** Skip firewall setup. */
  readonly skipFirewall?: boolean;
  /** Block ALL egress including DNS (air-gap mode). */
  readonly airGap?: boolean;
  /** OCI runtime (e.g. "runsc" for gVisor) — passed to preflight for runtime check. */
  readonly runtime?: string;
  /** Auto-enable firewall based on posture (hardened/paranoid). */
  readonly autoFirewall?: boolean;
  /** Mark identity files immutable (chattr +i) after deploy. */
  readonly immutableIdentity?: boolean;
  /** Progress callback for step-by-step reporting. */
  readonly onProgress?: ProgressCallback;
  /** AbortSignal for cancellation. */
  readonly signal?: AbortSignal;
}

/** Result of a deploy operation. */
export interface DeployResult {
  readonly success: boolean;
  readonly preflight: PreflightReport | null;
  /** Whether the agent is confirmed reachable. */
  readonly healthy: boolean;
  readonly error?: string;
}

// ── Shutdown / Restart ──────────────────────────────────────────────────────

/** Options for shutdown (down) and restart. */
export interface ShutdownOptions {
  readonly deployDir: string;
  /** Remove volumes on shutdown. */
  readonly removeVolumes?: boolean;
  /** Progress callback. */
  readonly onProgress?: ProgressCallback;
  /** AbortSignal for cancellation. */
  readonly signal?: AbortSignal;
}

/** Result of a shutdown operation. */
export interface ShutdownResult {
  readonly success: boolean;
  readonly error?: string;
}

// ── Firewall ────────────────────────────────────────────────────────────────

/** A domain allowlist entry for egress firewall. */
export interface FirewallAllowEntry {
  readonly domain: string;
  readonly port: number;
  readonly comment?: string;
}

/** Options for firewall apply/remove/verify. */
export interface FirewallOptions {
  readonly deployDir: string;
  readonly allowlist?: readonly FirewallAllowEntry[];
  /** Block ALL egress including DNS. The paranoid user's kill switch. */
  readonly airGap?: boolean;
  readonly signal?: AbortSignal;
}

/** Result of a firewall operation. */
export interface FirewallResult {
  readonly success: boolean;
  readonly rulesApplied: number;
  /** Number of IPs resolved from domain DNS lookups into the ipset. */
  readonly resolvedIps?: number;
  readonly error?: string;
  /** Warning when firewall is partially applied (e.g. ipset unavailable). */
  readonly warning?: string;
}

/** Result of firewall verification (expected vs actual rule diff). */
export interface FirewallVerifyResult {
  /** True when live rules match expected rules. */
  readonly matches: boolean;
  readonly expectedCount: number;
  readonly actualCount: number;
  /** Rules that should exist but don't. */
  readonly missing: readonly import("./firewall.js").FirewallRuleDescriptor[];
  /** Rules that exist but shouldn't. */
  readonly extra: readonly import("./firewall.js").FirewallRuleDescriptor[];
  readonly error?: string;
}

/** Metadata for the ipset, written to ops/firewall/ipset-meta.json for staleness detection. */
export interface IpsetMeta {
  /** ISO 8601 timestamp of last DNS resolution refresh. */
  readonly lastRefreshed: string;
  /** Refresh interval in milliseconds. */
  readonly refreshIntervalMs: number;
  /** Domains that were resolved. */
  readonly domains: readonly string[];
  /** Count of resolved IPv4 addresses in the ipset. */
  readonly resolvedV4: number;
  /** Count of resolved IPv6 addresses in the ipset. */
  readonly resolvedV6: number;
  /** ipset set names. */
  readonly setName: string;
  readonly setNameV6: string;
}

// ── Connect (Channel Setup) ─────────────────────────────────────────────────

/** Named steps in the connect sequence, reported via progress callback. */
export type ConnectStepName =
  | "write-credentials"
  | "update-config"
  | "health-ping"
  | "test-message";

/** Progress event emitted during channel connection. */
export interface ConnectProgress {
  readonly step: ConnectStepName;
  readonly status: DeployStepStatus;
  readonly message: string;
}

/** Callback for connect progress reporting. */
export type ConnectProgressCallback = (progress: ConnectProgress) => void;

/** Options for the connect command. */
export interface ConnectOptions {
  /** Path to the deployment directory. */
  readonly deployDir: string;
  /** Channel to connect. */
  readonly channel: "telegram" | "whatsapp";
  /** Channel credentials to store. */
  readonly credentials: {
    readonly channel: "telegram" | "whatsapp";
    readonly vars: Record<string, string>;
  };
  /** Gateway auth token for health ping. */
  readonly gatewayToken: string;
  /** Gateway port (default: GATEWAY_DEFAULT_PORT). */
  readonly gatewayPort?: number;
  /** Agent name for the test message. */
  readonly agentName?: string;
  /** Progress callback. */
  readonly onProgress?: ConnectProgressCallback;
}

/** Result of the connect operation. */
export interface ConnectResult {
  readonly success: boolean;
  readonly channel: "telegram" | "whatsapp";
  /** Whether the test message was successfully sent. */
  readonly testMessageSent?: boolean;
  readonly error?: string;
}

// ── Health Verify ───────────────────────────────────────────────────────────

/** Options for post-deploy health verification. */
export interface HealthVerifyOptions {
  readonly gatewayToken: string;
  readonly gatewayPort?: number;
  readonly gatewayHost?: string;
  /** Max time to wait for healthy state (ms). Default: 60000. */
  readonly timeoutMs?: number;
  /** Interval between health checks (ms). Default: 2000. */
  readonly intervalMs?: number;
  readonly signal?: AbortSignal;
}

/** Result of health verification. */
export interface HealthVerifyResult {
  readonly healthy: boolean;
  readonly attempts: number;
  readonly elapsedMs: number;
  readonly error?: string;
}

// ── Smoke Test ─────────────────────────────────────────────────────────────

/** Options for the post-deploy smoke test (real message exchange). */
export interface SmokeTestOptions extends HealthVerifyOptions {
  /** Timeout for the smoke test message round-trip (ms). Default: 30000. */
  readonly smokeTimeoutMs?: number;
  /** Custom smoke test message. Default: built-in ping. */
  readonly smokeMessage?: string;
}

/** Result of the smoke test — proves the agent actually works. */
export interface SmokeTestResult extends HealthVerifyResult {
  /** Whether a real message was sent to the agent. */
  readonly messageSent: boolean;
  /** Whether the agent responded to the message. */
  readonly responseReceived: boolean;
  /** Truncated agent reply (first 200 chars). */
  readonly agentReply?: string;
  /** True if fell back to status-only check (older OpenClaw). */
  readonly fallback?: boolean;
}

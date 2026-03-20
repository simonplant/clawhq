/**
 * Config types for ClawHQ and OpenClaw.
 *
 * These types define the contract that every config-generating command
 * validates against. They cover the OpenClaw runtime config (openclaw.json),
 * ClawHQ's own config (clawhq.yaml), deployment bundles, and cron jobs.
 */

// ── OpenClaw Runtime Config (openclaw.json) ─────────────────────────────────

/** Exec tool host mode. */
export type ExecHost = "gateway" | "sandbox" | "node";

/** Exec tool security level. */
export type ExecSecurity = "full" | "allowlist" | "ask" | "auto";

/** Tool execution settings. */
export interface ToolExecConfig {
  readonly host: ExecHost;
  readonly security: ExecSecurity;
  readonly safeBins?: readonly string[];
}

/** Tool configuration. */
export interface ToolsConfig {
  readonly profile?: "coding" | "messaging" | "custom";
  readonly allow?: readonly string[];
  readonly deny?: readonly string[];
  readonly exec: ToolExecConfig;
}

/** Gateway server configuration. */
export interface GatewayConfig {
  readonly port: number;
  readonly bind: string;
  readonly auth?: {
    readonly token?: string;
    readonly password?: string;
  };
  readonly reload?: {
    readonly mode?: "hybrid" | "hot" | "restart" | "off";
  };
}

/** Filesystem access configuration. */
export interface FsConfig {
  readonly workspaceOnly: boolean;
}

/** Agent definition within multi-agent config. */
export interface AgentEntry {
  readonly id: string;
  readonly default?: boolean;
  readonly workspace: string;
}

/** Agent binding for multi-agent routing. */
export interface AgentBinding {
  readonly agentId: string;
  readonly match: {
    readonly channel?: string;
    readonly peer?: {
      readonly kind?: string;
      readonly id?: string;
    };
  };
}

/** Agents configuration. */
export interface AgentsConfig {
  readonly list?: readonly AgentEntry[];
  readonly bindings?: readonly AgentBinding[];
  readonly defaults?: {
    readonly model?: {
      readonly primary?: string;
      readonly fallbacks?: readonly string[];
    };
  };
}

/** Identity configuration fields in openclaw.json. */
export interface IdentityConfig {
  readonly name?: string;
  readonly theme?: string;
  readonly emoji?: string;
  readonly avatar?: string;
  readonly bootstrapMaxChars?: number;
}

/** Channel DM policy. */
export type DmPolicy = "pairing" | "allowlist" | "open" | "disabled";

/** Base channel configuration. */
export interface ChannelConfig {
  readonly enabled: boolean;
  readonly dmPolicy?: DmPolicy;
  readonly allowFrom?: readonly string[];
  readonly groupPolicy?: string;
  readonly configWrites?: boolean;
}

/** Cron configuration in openclaw.json. */
export interface CronConfig {
  readonly enabled?: boolean;
  readonly maxConcurrentRuns?: number;
}

/** Session configuration. */
export interface SessionConfig {
  readonly dmScope?:
    | "main"
    | "per-peer"
    | "per-channel-peer"
    | "per-account-channel-peer";
}

/**
 * OpenClaw runtime configuration (openclaw.json).
 *
 * Partial representation — covers fields relevant to landmine validation
 * and config generation. Unknown fields are preserved during merge.
 */
export interface OpenClawConfig {
  readonly dangerouslyDisableDeviceAuth?: boolean;
  readonly allowedOrigins?: readonly string[];
  readonly trustedProxies?: readonly string[];
  readonly tools?: ToolsConfig;
  readonly gateway?: GatewayConfig;
  readonly fs?: FsConfig;
  readonly agents?: AgentsConfig;
  readonly identity?: IdentityConfig;
  readonly channels?: Record<string, ChannelConfig>;
  readonly cron?: CronConfig;
  readonly session?: SessionConfig;
  readonly [key: string]: unknown;
}

// ── Docker Compose Config (for landmine validation) ─────────────────────────

/** Volume mount definition. */
export interface VolumeMount {
  readonly source: string;
  readonly target: string;
  readonly readOnly?: boolean;
}

/** Docker Compose service configuration (relevant fields). */
export interface ComposeServiceConfig {
  readonly user?: string;
  readonly cap_drop?: readonly string[];
  readonly security_opt?: readonly string[];
  readonly read_only?: boolean;
  readonly volumes?: readonly (string | VolumeMount)[];
  readonly networks?: readonly string[];
  readonly environment?: Record<string, string>;
  readonly env_file?: readonly string[];
}

/** Docker Compose file (relevant fields). */
export interface ComposeConfig {
  readonly services?: Record<string, ComposeServiceConfig>;
  readonly networks?: Record<
    string,
    {
      readonly external?: boolean;
      readonly driver?: string;
      readonly driver_opts?: Record<string, string>;
    }
  >;
}

// ── Cron Job Definition ─────────────────────────────────────────────────────

/** Cron job kind. */
export type CronJobKind = "cron" | "every";

/** Cron job delivery mode. */
export type CronDelivery = "announce" | "none" | "errors";

/** Active hours constraint for cron jobs. */
export interface ActiveHours {
  readonly start: number;
  readonly end: number;
  readonly tz?: string;
}

/**
 * OpenClaw-native cron job definition.
 *
 * Written to `cron/jobs.json`. The Gateway hot-reloads this file.
 */
export interface CronJobDefinition {
  readonly id: string;
  readonly kind: CronJobKind;
  readonly expr?: string;
  readonly everyMs?: number;
  readonly task: string;
  readonly enabled: boolean;
  readonly delivery?: CronDelivery;
  readonly model?: string;
  readonly session?: "main" | "isolated";
  readonly activeHours?: ActiveHours;
}

// ── Identity File Info (for bootstrap char validation) ──────────────────────

/** Metadata about a workspace identity file. */
export interface IdentityFileInfo {
  readonly name: string;
  readonly path: string;
  readonly sizeBytes: number;
}

/** Metadata about a generated workspace tool wrapper. */
export interface ToolFileInfo {
  readonly name: string;
  readonly path: string;
  readonly sizeBytes: number;
  readonly mode: number;
}

// ── ClawHQ Config (clawhq.yaml) ─────────────────────────────────────────────

/** Security posture level. */
export type SecurityPosture = "minimal" | "standard" | "hardened" | "paranoid";

/** Cloud trust mode. */
export type TrustMode = "paranoid" | "zero-trust" | "managed";

/** Engine acquisition method. */
export type InstallMethod = "cache" | "source";

/** Notification channel type for monitor config. */
export type NotificationChannelType = "telegram" | "email" | "webhook";

/** Monitor configuration within clawhq.yaml. */
export interface MonitorConfig {
  readonly enabled?: boolean;
  /** Check interval in seconds (default: 30). */
  readonly intervalSeconds?: number;
  readonly notifications?: {
    readonly channels?: readonly {
      readonly type: NotificationChannelType;
      readonly enabled: boolean;
      readonly [key: string]: unknown;
    }[];
    readonly alertsEnabled?: boolean;
    readonly digestEnabled?: boolean;
    /** Hour (0-23) to send daily digest (default: 8). */
    readonly digestHour?: number;
  };
  readonly recovery?: {
    readonly enabled?: boolean;
    readonly maxAttemptsPerHour?: number;
    readonly cooldownSeconds?: number;
  };
  readonly thresholds?: {
    readonly diskWarningPercent?: number;
    readonly diskCriticalPercent?: number;
    readonly memoryWarningPercent?: number;
    readonly cpuSustainedPercent?: number;
  };
}

/**
 * ClawHQ's own configuration (clawhq.yaml).
 *
 * Lives at `~/.clawhq/clawhq.yaml`. Separate from OpenClaw's config.
 */
export interface ClawHQConfig {
  readonly version?: string;
  readonly installMethod?: InstallMethod;
  readonly security?: {
    readonly posture?: SecurityPosture;
    readonly egress?: "default" | "restricted" | "allowlist-only";
    readonly airGap?: boolean;
  };
  readonly cloud?: {
    readonly enabled?: boolean;
    readonly trustMode?: TrustMode;
    readonly token?: string;
  };
  readonly monitor?: MonitorConfig;
  readonly paths?: {
    readonly deployDir?: string;
    readonly engineDir?: string;
    readonly workspaceDir?: string;
    readonly opsDir?: string;
  };
  readonly [key: string]: unknown;
}

// ── Deployment Bundle ───────────────────────────────────────────────────────

/**
 * Complete deployment bundle — everything generated during forge.
 *
 * Represents all files produced by `clawhq init` from a blueprint.
 */
export interface DeploymentBundle {
  readonly openclawConfig: OpenClawConfig;
  readonly composeConfig: ComposeConfig;
  readonly envVars: Record<string, string>;
  readonly cronJobs: readonly CronJobDefinition[];
  readonly identityFiles: readonly IdentityFileInfo[];
  readonly toolFiles: readonly ToolFileInfo[];
  readonly clawhqConfig: ClawHQConfig;
}

// ── Validation Types ────────────────────────────────────────────────────────

/** Severity of a validation finding. */
export type ValidationSeverity = "error" | "warning";

/** Single validation result from a landmine rule. */
export interface ValidationResult {
  readonly rule: string;
  readonly passed: boolean;
  readonly severity: ValidationSeverity;
  readonly message: string;
  readonly fix?: string;
}

/** Aggregate result from running all validation rules. */
export interface ValidationReport {
  readonly valid: boolean;
  readonly results: readonly ValidationResult[];
  readonly errors: readonly ValidationResult[];
  readonly warnings: readonly ValidationResult[];
}

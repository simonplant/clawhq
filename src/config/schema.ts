/**
 * OpenClaw configuration schema types.
 *
 * These types represent the structure of openclaw.json as documented in
 * OPENCLAW-REFERENCE.md. When OpenClaw is available as an npm dependency,
 * replace these with direct imports from its TypeBox schema
 * (src/config/schema.ts).
 */

// --- Gateway ---

export interface GatewayAuth {
  token?: string;
  password?: string;
}

export interface GatewayReload {
  mode?: "hybrid" | "hot" | "restart" | "off";
}

export interface GatewayConfig {
  port?: number;
  bind?: string;
  auth?: GatewayAuth;
  reload?: GatewayReload;
}

// --- Identity ---

export interface IdentityConfig {
  name?: string;
  theme?: string;
  emoji?: string;
  avatar?: string;
}

// --- Tools ---

export interface ToolsExec {
  host?: "sandbox" | "gateway" | "node";
  security?: "allowlist" | "ask" | "auto" | "full";
  safeBins?: string[];
}

export interface ToolsConfig {
  profile?: "coding" | "messaging" | "custom";
  allow?: string[];
  deny?: string[];
  exec?: ToolsExec;
}

// --- Sandbox ---

export interface SandboxConfig {
  mode?: "off" | "non-main" | "all";
  scope?: "session" | "agent" | "shared";
}

// --- Session ---

export interface SessionConfig {
  dmScope?: "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer";
}

// --- Filesystem ---

export interface FsConfig {
  workspaceOnly?: boolean;
}

// --- Model provider ---

export interface ModelProviderConfig {
  apiKey?: string;
  [key: string]: unknown;
}

export interface ModelsConfig {
  providers?: Record<string, ModelProviderConfig>;
}

// --- Agents ---

export interface AgentModelConfig {
  primary?: string;
  fallbacks?: string[];
}

export interface AgentDefaults {
  model?: AgentModelConfig;
}

export interface AgentEntry {
  id: string;
  default?: boolean;
  workspace: string;
}

export interface AgentBinding {
  agentId: string;
  match: {
    channel: string;
    peer?: {
      kind: "direct" | "group";
      id: string;
    };
  };
}

export interface AgentsConfig {
  defaults?: AgentDefaults;
  list?: AgentEntry[];
  bindings?: AgentBinding[];
  [key: string]: unknown;
}

// --- Channels ---

export interface ChannelConfig {
  enabled?: boolean;
  [key: string]: unknown;
}

// --- Cron ---

export interface CronConfig {
  enabled?: boolean;
  maxConcurrentRuns?: number;
}

// --- Top-level OpenClaw config (openclaw.json) ---

export interface OpenClawConfig {
  dangerouslyDisableDeviceAuth?: boolean;
  allowedOrigins?: string[];
  trustedProxies?: string[];
  gateway?: GatewayConfig;
  identity?: IdentityConfig;
  tools?: ToolsConfig;
  sandbox?: SandboxConfig;
  session?: SessionConfig;
  fs?: FsConfig;
  models?: ModelsConfig;
  agents?: AgentsConfig;
  channels?: Record<string, ChannelConfig>;
  cron?: CronConfig;
  [key: string]: unknown;
}

// --- ClawHQ config (clawhq.yaml) ---

export interface ClawHQConfig {
  openclaw?: {
    home?: string;
    configPath?: string;
  };
  security?: {
    posture?: "standard" | "hardened" | "paranoid";
  };
  cloud?: {
    enabled?: boolean;
    token?: string;
  };
  docker?: {
    composePath?: string;
    networkName?: string;
  };
  [key: string]: unknown;
}

// --- Deployment Bundle ---

export interface DeploymentBundle {
  openclawConfig: OpenClawConfig;
  envVars: Record<string, string>;
  dockerCompose: string;
  dockerfile: string;
  identityFiles: Record<string, string>;
  workspaceTools: Record<string, string>;
  skills: Record<string, Record<string, string>>;
  cronJobs: CronJobDefinition[];
}

export interface CronJobDefinition {
  id: string;
  kind: "cron" | "every";
  expr?: string;           // 5-field cron expression (when kind === "cron")
  everyMs?: number;         // interval in ms (when kind === "every")
  task: string;             // prompt/instruction
  enabled: boolean;
  delivery?: "announce" | "none" | "errors";
  model?: string;           // per-job model override
  session?: "main" | "isolated";
  activeHours?: ActiveHoursConfig;
}

export interface ActiveHoursConfig {
  start: number;  // hour (0-23)
  end: number;    // hour (0-23)
  tz: string;     // IANA timezone
}

// --- Validation Result ---

export type ValidationStatus = "pass" | "warn" | "fail";

export interface ValidationResult {
  rule: string;
  status: ValidationStatus;
  message: string;
  fix: string;
}

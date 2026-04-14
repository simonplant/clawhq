/**
 * Config types, schema validation, and loader for ClawHQ.
 *
 * The config module is cross-cutting — used by every config-generating command
 * to validate against the 14 landmine rules and load merged configuration.
 */

// Types
export type {
  ActiveHours,
  AgentBinding,
  AgentEntry,
  AgentsConfig,
  ChannelConfig,
  ClawHQConfig,
  ComposeConfig,
  ComposeServiceConfig,
  CronConfig,
  CronJobDefinition,
  DeploymentBundle,
  DmPolicy,
  ExecHost,
  ExecSecurity,
  FsConfig,
  GatewayConfig,
  IdentityConfig,
  IdentityFileInfo,
  InstallMethod,
  OpenClawConfig,
  SecurityPosture,
  SentinelConfig,
  SessionConfig,
  ToolExecConfig,
  ToolsConfig,
  TrustMode,
  ValidationReport,
  ValidationResult,
  ValidationSeverity,
  VolumeMount,
} from "./types.js";

// Validation
export {
  validateBundle,
  validateLM01,
  validateLM02,
  validateLM03,
  validateLM04,
  validateLM05,
  validateLM06,
  validateLM07,
  validateLM08,
  validateLM09,
  validateLM10,
  validateLM11,
  validateLM12,
  validateLM13,
  validateLM14,
} from "./validate.js";

// Loader
export { deepMerge, defaultConfig, loadConfig } from "./loader.js";
export type { LoadConfigOptions } from "./loader.js";

// Defaults
export { GATEWAY_DEFAULT_PORT } from "./defaults.js";

// Paths
export {
  DEFAULT_DEPLOY_DIR,
  LEGACY_DEPLOY_DIR,
  OPENCLAW_CONTAINER_CONFIG,
  OPENCLAW_CONTAINER_CREDENTIALS,
  OPENCLAW_CONTAINER_CRON,
  OPENCLAW_CONTAINER_ROOT,
  OPENCLAW_CONTAINER_WORKSPACE,
} from "./paths.js";

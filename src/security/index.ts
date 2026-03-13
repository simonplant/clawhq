// Security toolchain
// See docs/ARCHITECTURE.md for module responsibilities

export {
  checkEnvPermissions,
  enforceEnvPermissions,
  envToObject,
  getEnvValue,
  parseEnv,
  readEnvFile,
  removeEnvValue,
  scanContent,
  scanFiles,
  SECRET_PATTERNS,
  serializeEnv,
  setEnvValue,
  writeEnvFile,
} from "./secrets/index.js";

export type {
  EnvEntry,
  EnvFile,
  PermissionStatus,
  ScanMatch,
  ScanResult,
  SecretPattern,
} from "./secrets/index.js";

export {
  anthropicProbe,
  DEFAULT_PROBES,
  formatCredTable,
  openaiProbe,
  runProbes,
  runProbesFromFile,
  telegramProbe,
} from "./credentials/index.js";

export type {
  CredentialProbe,
  CredReport,
  CredResult,
  CredStatus,
} from "./credentials/index.js";

export {
  apply as firewallApply,
  buildConfig as firewallBuildConfig,
  buildExpectedRules,
  chainExists,
  checkPlatform,
  deriveAllowlist,
  listRules,
  remove as firewallRemove,
  resolveAllowlist,
  resolveDomain,
  verify as firewallVerify,
} from "./firewall/index.js";

export type {
  AllowlistEntry,
  FirewallConfig,
  FirewallResult,
  ProviderDomains,
  VerifyResult as FirewallVerifyResult,
} from "./firewall/index.js";

export { BASE_DOMAINS, CHAIN_NAME, PROVIDER_DOMAINS } from "./firewall/index.js";

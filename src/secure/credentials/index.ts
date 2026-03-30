/**
 * Credentials module — .env secrets store + credential health probes.
 *
 * Provides safe read/write/modify operations for .env files with:
 * - Format preservation (comments, blank lines, ordering)
 * - Atomic writes (temp file + rename — no partial files)
 * - 0600 permissions (owner read/write only)
 *
 * Plus probe-based credential validation:
 * - Extensible probe interface for any integration
 * - Built-in probes for Anthropic, OpenAI, Telegram
 * - Report aggregation and terminal table formatter
 */

// .env types
export type { EnvFile, EnvLine, ReadEnvOptions, WriteEnvOptions } from "./types.js";

// .env core operations
export {
  deleteEnvValue,
  getAllEnvValues,
  getEnvValue,
  parseEnv,
  readEnv,
  readEnvValue,
  removeEnvValue,
  serializeEnv,
  setEnvValue,
  verifyEnvPermissions,
  writeEnvAtomic,
  writeEnvValue,
} from "./env-store.js";

// Probe types
export type { CredentialProbe, ProbeReport, ProbeResult } from "./probe-types.js";

// Probe framework
export { formatProbeReport, runProbes } from "./health.js";
export type { RunProbesOptions } from "./health.js";

// Built-in probes
export { builtinProbes, probe1Password, probeAnthropic, probeOpenAI, probeTelegram } from "./probes.js";

// 1Password credential fetch (claw-secret)
export {
  checkVaultAccess,
  fetchSecret,
  OP_TOKEN_SECRET_PATH,
  readServiceAccountToken,
} from "./claw-secret.js";
export type { FetchSecretOptions, SecretFetchResult, VaultCheckResult } from "./claw-secret.js";

// Credential store (credentials.json — integration credentials separate from .env)
export type { CredentialEntry, CredentialStore } from "./credential-store-types.js";
export {
  credentialsPath,
  deleteIntegrationCredentials,
  getCredentials,
  readCredentialStore,
  removeCredentials,
  setCredentials,
  storeIntegrationCredentials,
  verifyCredentialPermissions,
  writeCredentialStore,
} from "./credential-store.js";

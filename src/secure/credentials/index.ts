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
export { builtinProbes, probeAnthropic, probeOpenAI, probeTelegram } from "./probes.js";

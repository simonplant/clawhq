/**
 * Secure module — security and compliance.
 *
 * Hardening, credentials, firewall, audit. Security is architecture, not policy (AD-05).
 */

// Credentials (.env store + health probes)
export type { EnvFile, EnvLine, ReadEnvOptions, WriteEnvOptions } from "./credentials/index.js";
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
} from "./credentials/index.js";

// Credential health probes
export type { CredentialProbe, ProbeReport, ProbeResult } from "./credentials/index.js";
export { builtinProbes, formatProbeReport, probeAnthropic, probeOpenAI, probeTelegram, runProbes } from "./credentials/index.js";
export type { RunProbesOptions } from "./credentials/index.js";

// Sanitizer (input injection firewall)
export {
  detectThreats,
  normalizeConfusables,
  sanitize,
  sanitizeContent,
  sanitizeContentSync,
  sanitizeJson,
  threatScore,
  wrapUntrusted,
  writeAuditLog,
  writeQuarantine,
} from "./sanitizer/index.js";
export type {
  AuditConfig,
  AuditEntry,
  NormalizeResult,
  QuarantineEntry,
  SanitizeContentOptions,
  SanitizeOptions,
  SanitizeResult,
  Threat,
  ThreatCategory,
  ThreatSeverity,
} from "./sanitizer/index.js";

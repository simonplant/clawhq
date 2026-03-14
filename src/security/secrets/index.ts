export {
  atomicWriteEnvFile,
  envToObject,
  getEnvValue,
  parseEnv,
  readEnvFile,
  removeEnvValue,
  serializeEnv,
  setEnvValue,
  writeEnvFile,
} from "./env.js";
export type { EnvEntry, EnvFile } from "./env.js";
export { checkEnvPermissions, enforceEnvPermissions } from "./permissions.js";
export type { PermissionStatus } from "./permissions.js";
export {
  enforceMetaPermissions,
  inferCategory,
  readMetadata,
  removeSecretMetadata,
  setSecretMetadata,
  writeMetadata,
} from "./metadata.js";
export {
  ALL_PATTERNS,
  formatScanTable,
  isDangerousFilename,
  isFalsePositive,
  PII_PATTERNS,
  redactPreview,
  scanContent,
  scanFiles,
  scanGitHistory,
  SECRET_PATTERNS,
} from "./scanner.js";
export type { MatchType, ScanMatch, ScanResult, SecretPattern } from "./scanner.js";
export {
  auditKeyPath,
  auditPath,
  computeEventHmac,
  emitSecretAuditEvent,
  getOrCreateAuditKey,
  readAuditEvents,
  verifyAuditChain,
} from "./audit.js";
export type {
  AuditVerifyError,
  AuditVerifyResult,
  SecretAuditEvent,
  SecretAuditEventType,
} from "./audit.js";
export { scanDanglingReferences } from "./references.js";
export type { DanglingReference } from "./references.js";
export type { MetadataFile, SecretEntry, SecretMetadata } from "./types.js";

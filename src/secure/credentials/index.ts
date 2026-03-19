/**
 * .env secrets store — atomic, 0600-permissioned, format-preserving.
 *
 * Provides safe read/write/modify operations for .env files with:
 * - Format preservation (comments, blank lines, ordering)
 * - Atomic writes (temp file + rename — no partial files)
 * - 0600 permissions (owner read/write only)
 */

// Types
export type { EnvFile, EnvLine, ReadEnvOptions, WriteEnvOptions } from "./types.js";

// Core operations
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

/**
 * Docker two-stage build and container hardening.
 *
 * The build module handles:
 * - Two-stage Dockerfile generation (base + custom layers)
 * - Hash-based change detection for cache invalidation
 * - Security posture application (minimal/standard/hardened/paranoid)
 * - Build manifest generation with image hash and layer info
 * - Docker Compose generation with container hardening
 */

// Build orchestrator
export { build, serializeYaml } from "./build.js";

// Dockerfile generation
export {
  generateStage2Dockerfile,
  validateBinaryDestPath,
  validateBinaryUrl,
} from "./dockerfile.js";

// Compose generation
export { generateCompose } from "./compose.js";
export type { ComposeOptions, ComposeOutput } from "./compose.js";

// Security postures
export { DEFAULT_POSTURE, getPostureConfig, POSTURE_LEVELS } from "./posture.js";

// Posture YAML writer
export { generatePostureYaml, posturePath, readCurrentPosture, writePostureYaml } from "./posture-writer.js";

// Cache detection
export { checkCache, computeStage1Hash, computeStage2Hash, manifestPath } from "./cache.js";

// Manifest
export { createManifest, readManifest, writeManifest } from "./manifest.js";

// Binary manifest (SHA256 pinning)
export {
  formatHashMismatch,
  OP_CLI_APT_DEPS,
  OP_CLI_DEST,
  OP_CLI_URL,
  OP_CLI_VERSION,
  validateBinarySha256,
} from "./binary-manifest.js";
export type { BinaryVerificationResult, VerificationReport } from "./binary-manifest.js";

// Hash verification
export { verifyBinaryHashes } from "./verify-hashes.js";

// Binary dependency definitions
export { CORE_BINARIES, getRequiredBinaries, TOOL_BINARY_DEPS } from "./binary-deps.js";

// Workspace integrity
export { generateIntegrityManifest } from "./integrity.js";
export type { IntegrityEntry, IntegrityManifest } from "./integrity.js";

// Types
export type {
  BinaryInstall,
  BuildManifest,
  BuildOptions,
  BuildResult,
  BuildSecurityPosture,
  CacheCheckResult,
  ManifestLayer,
  PostureConfig,
  ResourceLimits,
  Stage1Config,
  Stage2Config,
  TmpfsConfig,
  WorkspaceManifest,
} from "./types.js";

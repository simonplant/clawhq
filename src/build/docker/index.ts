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
export { build } from "./build.js";

// Dockerfile generation
export {
  generateStage1Dockerfile,
  generateStage2Dockerfile,
  validateBinaryDestPath,
  validateBinaryUrl,
} from "./dockerfile.js";

// Compose generation
export { generateCompose } from "./compose.js";
export type { ComposeOutput } from "./compose.js";

// Instance identity (multi-instance isolation, FEAT-110)
export { getInstanceNames } from "./instance.js";
export type { InstanceNames } from "./instance.js";

// Security postures
export { DEFAULT_POSTURE, getPostureConfig, POSTURE_LEVELS } from "./posture.js";

// Posture YAML writer
export { generatePostureYaml, posturePath, readCurrentPosture, writePostureYaml } from "./posture-writer.js";

// Cache detection
export { checkCache, computeStage1Hash, computeStage2Hash, manifestPath } from "./cache.js";

// Manifest
export { createManifest, readManifest, writeManifest } from "./manifest.js";

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
} from "./types.js";

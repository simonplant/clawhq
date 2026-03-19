/**
 * Build module — install and deploy.
 *
 * Handles engine acquisition, Docker build, and deploy orchestration.
 * Currently implements the Docker two-stage build with container hardening.
 */

export {
  build,
  checkCache,
  computeStage1Hash,
  computeStage2Hash,
  createManifest,
  DEFAULT_POSTURE,
  generateCompose,
  generateStage1Dockerfile,
  generateStage2Dockerfile,
  getPostureConfig,
  manifestPath,
  POSTURE_LEVELS,
  readManifest,
  writeManifest,
} from "./docker/index.js";

export type {
  BinaryInstall,
  BuildManifest,
  BuildOptions,
  BuildResult,
  BuildSecurityPosture,
  CacheCheckResult,
  ComposeOutput,
  ManifestLayer,
  PostureConfig,
  ResourceLimits,
  Stage1Config,
  Stage2Config,
  TmpfsConfig,
} from "./docker/index.js";

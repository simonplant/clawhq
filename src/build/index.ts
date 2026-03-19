/**
 * Build module — install and deploy.
 *
 * Handles engine acquisition, Docker build, and deploy orchestration.
 * Docker: two-stage build with container hardening.
 * Launcher: deploy orchestration with preflight, firewall, health verify.
 */

// Docker build
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

// Deploy orchestration (launcher)
export {
  applyFirewall,
  deploy,
  removeFirewall,
  restart,
  runPreflight,
  shutdown,
  smokeTest,
  verifyHealth,
} from "./launcher/index.js";

export type {
  DeployOptions,
  DeployProgress,
  DeployResult,
  DeployStepName,
  DeployStepStatus,
  FirewallAllowEntry,
  FirewallOptions,
  FirewallResult,
  HealthVerifyOptions,
  HealthVerifyResult,
  PreflightCheckName,
  PreflightCheckResult,
  PreflightReport,
  ProgressCallback,
  ShutdownOptions,
  ShutdownResult,
} from "./launcher/index.js";

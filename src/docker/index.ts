/**
 * Docker client wrapper and build orchestration.
 * See docs/ARCHITECTURE.md for module responsibilities.
 */

export {
  DockerClient,
  DockerError,
  DaemonNotRunning,
  ImageNotFound,
  PortConflict,
  HealthPollTimeout,
} from "./client.js";

export type {
  ExecResult,
  ContainerInfo,
  ImageInfo,
  ImageInspectResult,
  NetworkInfo,
  HealthStatus,
  HealthPollResult,
  HealthPollOptions,
  DockerClientOptions,
} from "./client.js";

export {
  twoStageBuild,
  generateManifest,
  writeManifest,
  readManifest,
  verifyAgainstManifest,
  detectStage1Changes,
  readStage1Hash,
  writeStage1Hash,
  formatDuration,
  formatSize,
} from "./build.js";

export type {
  BuildStageResult,
  TwoStageBuildOptions,
  TwoStageBuildResult,
  BuildManifest,
  BuildManifestStage,
  VerifyResult,
  DriftEntry,
} from "./build.js";

export { validateCompose, pullImages } from "./compose.js";
export type { ComposeServiceConfig, ComposeConfig } from "./compose.js";

export { applyHardening, POSTURE_CONTROLS } from "./hardening.js";
export type { SecurityPosture, HardeningOptions } from "./hardening.js";

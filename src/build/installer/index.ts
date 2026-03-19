/**
 * Installer module — prerequisite detection, scaffold, config write,
 * from-source build, artifact verification.
 *
 * Entry point for `clawhq install`.
 */

export { install } from "./install.js";
export { checkDocker, checkGit, checkNode, checkOllama, detectPrereqs } from "./prereqs.js";
export { scaffoldDirs, writeInitialConfig } from "./scaffold.js";
export { buildFromSource } from "./source.js";
export { saveReleaseDigest, verifyArtifact } from "./verify.js";
export type {
  InstallOptions,
  InstallResult,
  PrereqCheckResult,
  PrereqReport,
  ScaffoldResult,
  SourceBuildOptions,
  SourceBuildResult,
  VerifyResult,
} from "./types.js";

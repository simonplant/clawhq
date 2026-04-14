/**
 * Installer module — prerequisite detection, scaffold, config write,
 * from-source build, artifact verification.
 *
 * Entry point for `clawhq install`.
 */

export { install } from "./install.js";
export { detectLegacyInstallation, migrateDeployDir } from "./migrate.js";
export { checkDocker, checkGit, checkNode, checkOllama, detectPrereqs } from "./prereqs.js";
export { scaffoldDirs, writeInitialConfig } from "./scaffold.js";
export { buildFromSource, cloneEngine } from "./source.js";
export { verifyArtifact } from "./verify.js";
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
export type {
  MigrateOptions,
  MigrateProgressCallback,
  MigrateResult,
} from "./migrate.js";

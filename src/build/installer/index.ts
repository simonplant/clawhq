/**
 * Installer module — prerequisite detection, scaffold, config write.
 *
 * Entry point for `clawhq install`.
 */

export { install } from "./install.js";
export { checkDocker, checkNode, checkOllama, detectPrereqs } from "./prereqs.js";
export { scaffoldDirs, writeInitialConfig } from "./scaffold.js";
export type {
  InstallOptions,
  InstallResult,
  PrereqCheckResult,
  PrereqReport,
  ScaffoldResult,
} from "./types.js";

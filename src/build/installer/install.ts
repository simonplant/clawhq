/**
 * Install orchestrator for `clawhq install`.
 *
 * Coordinates: prerequisite detection → scaffold → config write → clone engine.
 * For --from-source: adds build → verify steps.
 * Returns a structured result so the CLI can format output.
 */

import { detectPrereqs } from "./prereqs.js";
import { scaffoldDirs, writeInitialConfig } from "./scaffold.js";
import { buildFromSource, cloneEngine } from "./source.js";
import type { InstallOptions, InstallResult } from "./types.js";
import { verifyArtifact } from "./verify.js";

/**
 * Run the full install sequence.
 *
 * Standard path:
 * 1. Detect prerequisites (Docker, Node >=22, Ollama, Git)
 * 2. Create deployment directory structure
 * 3. Write clawhq.yaml with sensible defaults
 * 4. Clone OpenClaw repository to engine source dir
 *
 * From-source path (--from-source):
 * 1–4. Same as standard
 * 5. Build Docker image from source (network disabled)
 * 6. Verify built artifact matches release artifact
 */
export async function install(options: InstallOptions): Promise<InstallResult> {
  const fromSource = options.fromSource ?? false;

  // Step 1: Check prerequisites (always require git — need it for engine clone)
  const prereqs = await detectPrereqs({ fromSource: true });

  if (!prereqs.passed) {
    return {
      success: false,
      prereqs,
      error: "Prerequisites not met",
    };
  }

  // Step 2: Scaffold directory structure
  const scaffold = scaffoldDirs(options.deployDir);

  // Step 3: Write initial config
  const configPath = writeInitialConfig({
    deployDir: options.deployDir,
    installMethod: fromSource ? "source" : "cache",
  });

  // Step 4: Clone OpenClaw source repository
  const progress = options.onProgress ?? (() => {});
  progress("clone", "Cloning OpenClaw engine…");

  const cloneResult = await cloneEngine({
    deployDir: options.deployDir,
    repoUrl: options.repoUrl,
    ref: options.ref,
    onProgress: options.onProgress,
  });

  if (!cloneResult.success) {
    return {
      success: false,
      prereqs,
      scaffold,
      configPath,
      sourceBuild: cloneResult,
      error: cloneResult.error,
    };
  }

  // Standard path: engine cloned, ready for `clawhq build`
  if (!fromSource) {
    return {
      success: true,
      prereqs,
      scaffold,
      configPath,
      sourceBuild: cloneResult,
    };
  }

  // From-source path: also build the Docker image now

  // Step 5: Build Docker image from source
  const sourceBuild = await buildFromSource({
    deployDir: options.deployDir,
    repoUrl: options.repoUrl,
    ref: options.ref,
    onProgress: options.onProgress,
  });

  if (!sourceBuild.success) {
    return {
      success: false,
      prereqs,
      scaffold,
      configPath,
      sourceBuild,
      error: sourceBuild.error,
    };
  }

  // Step 6: Verify artifact
  const verify = await verifyArtifact(options.deployDir);

  return {
    success: true,
    prereqs,
    scaffold,
    configPath,
    sourceBuild,
    verify,
  };
}

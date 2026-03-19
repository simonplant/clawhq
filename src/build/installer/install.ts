/**
 * Install orchestrator for `clawhq install`.
 *
 * Coordinates: prerequisite detection → scaffold → config write.
 * For --from-source: adds clone → build → verify steps.
 * Returns a structured result so the CLI can format output.
 */

import { detectPrereqs } from "./prereqs.js";
import { scaffoldDirs, writeInitialConfig } from "./scaffold.js";
import { buildFromSource } from "./source.js";
import type { InstallOptions, InstallResult } from "./types.js";
import { verifyArtifact } from "./verify.js";

/**
 * Run the full install sequence.
 *
 * Standard path:
 * 1. Detect prerequisites (Docker, Node >=22, Ollama)
 * 2. Create ~/.clawhq/ directory structure
 * 3. Write clawhq.yaml with sensible defaults
 *
 * From-source path (--from-source):
 * 1. Detect prerequisites (Docker, Node >=22, Ollama, Git)
 * 2. Create ~/.clawhq/ directory structure
 * 3. Write clawhq.yaml
 * 4. Clone OpenClaw repository
 * 5. Build Docker image from source (network disabled)
 * 6. Verify built artifact matches release artifact
 */
export async function install(options: InstallOptions): Promise<InstallResult> {
  const fromSource = options.fromSource ?? false;

  // Step 1: Check prerequisites (includes git check for --from-source)
  const prereqs = await detectPrereqs({ fromSource });

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

  // Standard path: done
  if (!fromSource) {
    return {
      success: true,
      prereqs,
      scaffold,
      configPath,
    };
  }

  // From-source path: clone, build, verify

  // Step 4–5: Clone and build from source
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

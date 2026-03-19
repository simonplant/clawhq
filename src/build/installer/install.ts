/**
 * Install orchestrator for `clawhq install`.
 *
 * Coordinates: prerequisite detection → scaffold → config write.
 * Returns a structured result so the CLI can format output.
 */

import { detectPrereqs } from "./prereqs.js";
import { scaffoldDirs, writeInitialConfig } from "./scaffold.js";
import type { InstallOptions, InstallResult } from "./types.js";

/**
 * Run the full install sequence.
 *
 * 1. Detect prerequisites (Docker, Node >=20, Ollama)
 * 2. Create ~/.clawhq/ directory structure
 * 3. Write clawhq.yaml with sensible defaults
 */
export async function install(options: InstallOptions): Promise<InstallResult> {
  // Step 1: Check prerequisites
  const prereqs = await detectPrereqs();

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
    installMethod: options.fromSource ? "source" : "cache",
  });

  return {
    success: true,
    prereqs,
    scaffold,
    configPath,
  };
}

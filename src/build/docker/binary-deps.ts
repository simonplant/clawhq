/**
 * Binary dependency definitions for Docker image builds.
 *
 * Maps tool names to the binaries they require in the Docker image.
 * SHA256 hashes are pinned from the production clawdius Dockerfile (verified).
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { BinaryInstall } from "./types.js";

/**
 * Maps tool names to the binaries they require in the Docker image.
 * SHA256 hashes from the production clawdius Dockerfile (verified).
 */
export const TOOL_BINARY_DEPS: Record<string, BinaryInstall[]> = {
  email: [
    {
      name: "himalaya",
      url: "https://github.com/pimalaya/himalaya/releases/download/v1.2.0/himalaya.x86_64-linux.tgz",
      destPath: "/usr/local/bin/himalaya",
      sha256: "e04e6382e3e664ef34b01afa1a2216113194a2975d2859727647b22d9b36d4e4",
    },
  ],
};

/** Shared binaries that every profile gets (JSON processing, HTTP). */
export const CORE_BINARIES: BinaryInstall[] = [
  {
    name: "jq",
    url: "https://github.com/jqlang/jq/releases/download/jq-1.8.1/jq-linux-amd64",
    destPath: "/usr/local/bin/jq",
    sha256: "020468de7539ce70ef1bceaf7cde2e8c4f2ca6c3afb84642aabc5c97d9fc2a0d",
  },
];

/**
 * Determine which binaries are needed based on deployed workspace tools.
 * Reads the workspace directory to see which tools were deployed by init.
 */
export function getRequiredBinaries(deployDir: string): BinaryInstall[] {
  const workspaceDir = join(deployDir, "workspace");
  const seen = new Set<string>();
  const binaries: BinaryInstall[] = [...CORE_BINARIES];

  // Mark core binaries as seen
  for (const b of CORE_BINARIES) seen.add(b.name);

  if (!existsSync(workspaceDir)) return binaries;

  // Check which tools are deployed
  try {
    const files = readdirSync(workspaceDir);
    for (const file of files) {
      const deps = TOOL_BINARY_DEPS[file];
      if (deps) {
        for (const dep of deps) {
          if (!seen.has(dep.name)) {
            seen.add(dep.name);
            binaries.push(dep);
          }
        }
      }
    }
  } catch {
    // Workspace not readable — return core only
  }

  return binaries;
}

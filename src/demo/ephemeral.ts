/**
 * Ephemeral directory management for demo mode.
 *
 * Creates a temp directory for demo data and ensures cleanup on exit.
 * All demo state lives here and is removed when the demo stops.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface EphemeralDir {
  /** Absolute path to the ephemeral demo directory. */
  readonly path: string;
  /** Remove the directory and all contents. */
  cleanup: () => void;
}

/**
 * Create an ephemeral directory for demo data.
 * Registers cleanup handlers for SIGINT, SIGTERM, and normal exit.
 */
export function createEphemeralDir(): EphemeralDir {
  const dir = mkdtempSync(join(tmpdir(), "clawhq-demo-"));

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  };

  // Register cleanup on process exit signals
  process.on("exit", cleanup);

  return { path: dir, cleanup };
}

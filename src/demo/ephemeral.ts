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

  // Register cleanup on every way the process can die. `exit` alone doesn't
  // fire on SIGTERM/SIGINT, so a user hitting Ctrl-C on a demo would leave
  // the tmp dir behind. Handlers are defensively structured so a signal
  // during cleanup doesn't spiral: cleanup is idempotent (rm force:true)
  // and we re-emit the signal after cleaning to preserve process.exitCode.
  process.once("exit", cleanup);
  const signalCleanup = (signal: NodeJS.Signals): void => {
    cleanup();
    process.kill(process.pid, signal);
  };
  process.once("SIGINT", () => signalCleanup("SIGINT"));
  process.once("SIGTERM", () => signalCleanup("SIGTERM"));

  return { path: dir, cleanup };
}

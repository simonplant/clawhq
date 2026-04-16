/**
 * Shared utilities for backup and restore operations.
 */

import { spawn } from "node:child_process";

/** Snapshot storage directory relative to deployment directory. */
export const SNAPSHOTS_DIR = "ops/backup/snapshots";

/** Run a command with stdin input, returning a promise. */
export function spawnWithStdin(
  cmd: string,
  args: string[],
  stdinData: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr.trim()}`));
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    try {
      proc.stdin.write(stdinData);
      proc.stdin.end();
    } catch (err) {
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * Agent log streaming via Docker Compose.
 *
 * `clawhq logs [-f] [-n lines]` delegates to `docker compose logs`.
 * Supports follow mode (streaming) and fixed-line reads.
 * Never throws — returns structured result.
 */

import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import { LOGS_EXEC_TIMEOUT_MS } from "../../config/defaults.js";

import type { LogsOptions, LogsResult } from "./types.js";

const execFileAsync = promisify(execFile);

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Stream agent logs.
 *
 * In follow mode, streams lines via onLine callback until signal is aborted.
 * In non-follow mode, reads the last N lines and returns them.
 */
export async function streamLogs(options: LogsOptions): Promise<LogsResult> {
  const { deployDir, follow, lines = 50, signal, onLine } = options;
  const composePath = join(deployDir, "engine", "docker-compose.yml");

  if (follow) {
    return streamFollow(composePath, lines, signal, onLine);
  }

  return readLogs(composePath, lines, signal);
}

// ── Internal ────────────────────────────────────────────────────────────────

/**
 * Follow mode: spawn `docker compose logs -f` and stream lines.
 */
function streamFollow(
  composePath: string,
  tailLines: number,
  signal?: AbortSignal,
  onLine?: (line: string) => void,
): Promise<LogsResult> {
  return new Promise<LogsResult>((resolve) => {
    if (signal?.aborted) {
      resolve({ success: true, lineCount: 0 });
      return;
    }

    const args = [
      "compose", "-f", composePath, "logs",
      "--follow",
      "--tail", String(tailLines),
      "--no-log-prefix",
    ];

    const child = spawn("docker", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let lineCount = 0;
    let remainder = "";

    const processChunk = (chunk: Buffer): void => {
      const text = remainder + chunk.toString();
      const lines = text.split("\n");
      remainder = lines.pop() ?? "";

      for (const line of lines) {
        lineCount++;
        if (onLine) {
          onLine(line);
        } else {
          process.stdout.write(line + "\n");
        }
      }
    };

    child.stdout?.on("data", processChunk);
    child.stderr?.on("data", processChunk);

    const onAbort = (): void => {
      child.kill("SIGTERM");
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);

      // Flush remainder
      if (remainder) {
        lineCount++;
        if (onLine) {
          onLine(remainder);
        } else {
          process.stdout.write(remainder + "\n");
        }
      }

      // Exit code 137 (SIGKILL) or null (SIGTERM) is expected on abort
      if (signal?.aborted || code === 0 || code === null || code === 137) {
        resolve({ success: true, lineCount });
      } else {
        resolve({ success: false, error: `docker compose logs exited with code ${code}`, lineCount });
      }
    });

    child.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      resolve({ success: false, error: err.message });
    });
  });
}

/**
 * Non-follow mode: read the last N lines.
 */
async function readLogs(
  composePath: string,
  tailLines: number,
  signal?: AbortSignal,
): Promise<LogsResult> {
  try {
    const args = [
      "compose", "-f", composePath, "logs",
      "--tail", String(tailLines),
      "--no-log-prefix",
    ];

    const { stdout, stderr } = await execFileAsync("docker", args, {
      timeout: LOGS_EXEC_TIMEOUT_MS,
      signal,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large log reads
    });

    const output = (stdout + stderr).trim();
    const lineCount = output ? output.split("\n").length : 0;

    return { success: true, output, lineCount };
  } catch (err) {
    if (signal?.aborted) {
      return { success: true, lineCount: 0 };
    }
    const stderr = (err as { stderr?: string }).stderr?.trim();
    const reason = stderr || (err instanceof Error ? err.message : String(err));
    return { success: false, error: `Failed to read logs: ${reason}` };
  }
}

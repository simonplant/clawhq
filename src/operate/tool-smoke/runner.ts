/**
 * Tool-smoke runner — shells into the agent container and probes each
 * tool with its safe read verb. Captures exit code, stderr tail, and
 * duration. Never throws — every probe becomes a ToolSmokeResult, even
 * on docker-exec failure.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import type {
  ToolSmokeProbeSpec,
  ToolSmokeReport,
  ToolSmokeResult,
  ToolSmokeState,
} from "./types.js";

const execFileAsync = promisify(execFile);

/**
 * Run a single probe against a container. Returns a ToolSmokeResult;
 * never throws. Timeout is enforced; on exceed we mark exitCode=-1.
 */
export async function runToolProbe(
  container: string,
  spec: ToolSmokeProbeSpec,
  exec: typeof execFileAsync = execFileAsync,
): Promise<ToolSmokeResult> {
  const start = Date.now();
  try {
    await exec(
      "docker",
      ["exec", container, spec.tool, ...spec.args],
      { timeout: spec.timeoutSec * 1000, maxBuffer: 1024 * 1024 },
    );
    return {
      tool: spec.tool,
      ok: true,
      exitCode: 0,
      stderr: "",
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & { stderr?: string; code?: string | number; killed?: boolean };
    const isTimeout = e.killed === true;
    const stderr = (e.stderr ?? e.message ?? "").toString().slice(0, 200);
    // exec errors have a numeric `code` field for exit codes.
    const exitCode = isTimeout ? -1 : typeof e.code === "number" ? e.code : -2;
    return {
      tool: spec.tool,
      ok: false,
      exitCode,
      stderr,
      durationMs: Date.now() - start,
    };
  }
}

/** Run every probe in order. Sequential by default to avoid overloading
 *  the container. Caller supplies timeout per probe. */
export async function runToolSmoke(
  container: string,
  specs: readonly ToolSmokeProbeSpec[],
  exec: typeof execFileAsync = execFileAsync,
): Promise<ToolSmokeReport> {
  const timestamp = new Date().toISOString();
  const results: ToolSmokeResult[] = [];
  for (const spec of specs) {
    results.push(await runToolProbe(container, spec, exec));
  }
  const failCount = results.filter((r) => !r.ok).length;
  return { timestamp, container, results, failCount };
}

// ── State persistence ───────────────────────────────────────────────────────

const STATE_DIRNAME = "tool-smoke";
const STATE_FILENAME = "state.json";

/** Resolve the directory where tool-smoke state lives for a deployment. */
export function toolSmokeStateDir(deployDir: string): string {
  return join(deployDir, "ops", STATE_DIRNAME);
}

/** Resolve the state file path. */
export function toolSmokeStatePath(deployDir: string): string {
  return join(toolSmokeStateDir(deployDir), STATE_FILENAME);
}

/** Load the last tool-smoke state, or undefined if none has been written yet. */
export function loadToolSmokeState(deployDir: string): ToolSmokeState | undefined {
  const path = toolSmokeStatePath(deployDir);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ToolSmokeState;
  } catch {
    // Corrupt state file — treat as no prior state. Next run will
    // reset by producing a fresh report.
    return undefined;
  }
}

/** Persist a ToolSmokeState atomically (write + rename). */
export function saveToolSmokeState(deployDir: string, state: ToolSmokeState): void {
  mkdirSync(toolSmokeStateDir(deployDir), { recursive: true });
  const final = toolSmokeStatePath(deployDir);
  const tmp = `${final}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf-8");
  // rename is atomic on POSIX, so a concurrent reader sees either the
  // old full state or the new full state — never a half-written file.
  renameSync(tmp, final);
}

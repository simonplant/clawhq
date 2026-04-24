/**
 * Smoke runner — shells into the agent container and probes each tool
 * with its safe read verb. Captures exit code, stderr tail, duration.
 * Never throws — every probe result becomes a SmokeResult, even on
 * docker-exec failure.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import type {
  SmokeProbeSpec,
  SmokeReport,
  SmokeResult,
  SmokeState,
} from "./types.js";

const execFileAsync = promisify(execFile);

/**
 * Run a single probe against a container. Returns a SmokeResult; never
 * throws. Timeout is enforced; on exceed we mark exitCode=-1.
 */
export async function runProbe(
  container: string,
  spec: SmokeProbeSpec,
  exec: typeof execFileAsync = execFileAsync,
): Promise<SmokeResult> {
  const start = Date.now();
  try {
    const { stdout: _stdout } = await exec(
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
export async function runSmoke(
  container: string,
  specs: readonly SmokeProbeSpec[],
  exec: typeof execFileAsync = execFileAsync,
): Promise<SmokeReport> {
  const timestamp = new Date().toISOString();
  const results: SmokeResult[] = [];
  for (const spec of specs) {
    results.push(await runProbe(container, spec, exec));
  }
  const failCount = results.filter((r) => !r.ok).length;
  return { timestamp, container, results, failCount };
}

// ── State persistence ───────────────────────────────────────────────────────

const STATE_DIRNAME = "smoke";
const STATE_FILENAME = "state.json";

/** Resolve the directory where smoke state lives for a deployment. */
export function smokeStateDir(deployDir: string): string {
  return join(deployDir, "ops", STATE_DIRNAME);
}

/** Resolve the state file path. */
export function smokeStatePath(deployDir: string): string {
  return join(smokeStateDir(deployDir), STATE_FILENAME);
}

/** Load the last smoke state, or undefined if none has been written yet. */
export function loadSmokeState(deployDir: string): SmokeState | undefined {
  const path = smokeStatePath(deployDir);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as SmokeState;
  } catch {
    // Corrupt state file — treat as no prior state. Next run will
    // reset by producing a fresh report.
    return undefined;
  }
}

/** Persist a SmokeState atomically (write + rename). */
export function saveSmokeState(deployDir: string, state: SmokeState): void {
  mkdirSync(smokeStateDir(deployDir), { recursive: true });
  const final = smokeStatePath(deployDir);
  const tmp = `${final}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf-8");
  // rename is atomic on POSIX, so a concurrent reader sees either the
  // old full state or the new full state — never a half-written file.
  renameSync(tmp, final);
}

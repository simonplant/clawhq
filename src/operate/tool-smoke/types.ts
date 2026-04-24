/**
 * Tool smoke test — lightweight liveness probe for every workspace CLI
 * the agent can call. Runs a safe read-only verb per tool via `docker
 * exec` with a short timeout. Designed to run on a system-cron cadence
 * (every 5 min) with zero LLM tokens and minimal host load.
 *
 * State-transition-based alerting: user is pinged only when a tool
 * flips from ok → fail or fail → ok. Still-failing tools don't re-ping
 * every tick; consecutive-failure counters throttle notifications on
 * persistent outages via streak milestones.
 */

/** Per-tool smoke probe result. */
export interface ToolSmokeResult {
  /** Tool name as it appears on PATH and in TOOLS.md. */
  readonly tool: string;
  /** True when the command returned exit 0 within the timeout. */
  readonly ok: boolean;
  /** Exit code from the command; -1 for timeout, -2 for docker error. */
  readonly exitCode: number;
  /** Short stderr tail (first 200 chars) for debugging. Empty on ok. */
  readonly stderr: string;
  /** Wall-clock duration of the probe, in ms. */
  readonly durationMs: number;
}

/** A full tool-smoke run — one result per tool, plus the run timestamp. */
export interface ToolSmokeReport {
  /** ISO 8601 timestamp the run STARTED at. */
  readonly timestamp: string;
  /** Container the probe shelled into. */
  readonly container: string;
  /** Per-tool results in deterministic order. */
  readonly results: readonly ToolSmokeResult[];
  /** Count of failing tools in this run. */
  readonly failCount: number;
}

/** Persisted state — last run + per-tool consecutive failure streaks. */
export interface ToolSmokeState {
  /** The most recent report. */
  readonly lastReport: ToolSmokeReport;
  /** Tool name → consecutive-failures streak. Reset to 0 on success.
   *  Used to throttle notifications on prolonged outages. */
  readonly streaks: Readonly<Record<string, number>>;
}

/** One state transition worth notifying the user about. */
export interface ToolSmokeTransition {
  readonly tool: string;
  readonly kind: "new-failure" | "recovered" | "still-failing-notify";
  /** For `new-failure` + `still-failing-notify`: the failure reason. */
  readonly reason?: string;
  /** For `still-failing-notify`: which streak milestone this is. */
  readonly streakCount?: number;
}

/** Config for a single tool's smoke probe. */
export interface ToolSmokeProbeSpec {
  /** Tool name. Must match the PATH name inside the container. */
  readonly tool: string;
  /** Argv to pass to the tool. Defaults to `["--help"]` — every tool
   *  in the life-ops profile supports --help and it's the safest
   *  no-op. Override for tools where a richer read verb is cheap
   *  and more informative (e.g. `email folders`, `tasks today`). */
  readonly args: readonly string[];
  /** Timeout in seconds. Default 5. */
  readonly timeoutSec: number;
}

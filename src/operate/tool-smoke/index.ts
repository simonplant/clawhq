/**
 * Tool-smoke public API.
 *
 * Lightweight tool-liveness harness. Designed for a 5-min system-cron
 * cadence — probes every workspace tool with a safe read-only verb,
 * detects state transitions against the last run, and (optionally)
 * pings Telegram when something flips from ok → fail or back.
 *
 * Zero LLM tokens; ~5s per run (sequential docker exec with 5s
 * per-tool timeouts). Transition-based alerting means one ping per
 * break, not one per tick.
 */

export { notifyTelegram } from "./notify.js";
export type { NotifyOutcome } from "./notify.js";

export { SANITIZE_PROBE, specsForProfile } from "./probes.js";

export {
  loadToolSmokeState,
  runToolProbe,
  runToolSmoke,
  saveToolSmokeState,
  toolSmokeStateDir,
  toolSmokeStatePath,
} from "./runner.js";

export {
  detectToolSmokeTransitions,
  formatToolSmokeTransitionsForTelegram,
} from "./transition.js";
export type { ToolSmokeTransitionOutput } from "./transition.js";

export type {
  ToolSmokeProbeSpec,
  ToolSmokeReport,
  ToolSmokeResult,
  ToolSmokeState,
  ToolSmokeTransition,
} from "./types.js";

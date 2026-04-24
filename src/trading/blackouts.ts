/**
 * Event-calendar blackout feed.
 *
 * The governor consumes `RiskState.activeBlackouts` but doesn't know how to
 * derive them. This module is the derivation: given a list of scheduled
 * events (FOMC, CPI, NFP, per-ticker earnings) and a clock, return the
 * blackouts active right now.
 *
 * Data source: a shared JSON file at `${sharedDir}/blackouts.json`. The
 * earnings + market-calendar skills write to it; the sidecar reads it on
 * a timer. Pure parse+filter here — file I/O happens at the orchestrator
 * boundary so tests stay hermetic.
 */

import { readFileSync } from "node:fs";

import type { RiskState } from "./types.js";

/** Persistent shape written by the skills; read by the sidecar. */
export interface ScheduledEvent {
  /** Short label: "FOMC", "CPI", "NVDA earnings". */
  name: string;
  /** Event time (ms since epoch). */
  tsMs: number;
  /** Applies to every order, or only this ticker. */
  scope: "all" | { ticker: string };
  /** Minutes before tsMs the blackout starts (default 15). */
  windowBeforeMs?: number;
  /** Minutes after tsMs the blackout ends (default 60). */
  windowAfterMs?: number;
  /** Human-readable reason surfaced in alert annotations. */
  reason: string;
}

/** Same shape as `RiskState.activeBlackouts[number]` — exported for callers. */
export type ActiveBlackout = NonNullable<RiskState["activeBlackouts"]>[number];

const DEFAULT_WINDOW_BEFORE_MS = 15 * 60 * 1000;
const DEFAULT_WINDOW_AFTER_MS = 60 * 60 * 1000;

/**
 * Filter a scheduled-events list to those currently inside their blackout
 * window. Pure — all inputs explicit, no clock reads.
 */
export function activeAt(events: ScheduledEvent[], nowMs: number): ActiveBlackout[] {
  const out: ActiveBlackout[] = [];
  for (const ev of events) {
    const before = ev.windowBeforeMs ?? DEFAULT_WINDOW_BEFORE_MS;
    const after = ev.windowAfterMs ?? DEFAULT_WINDOW_AFTER_MS;
    const start = ev.tsMs - before;
    const end = ev.tsMs + after;
    if (nowMs >= start && nowMs <= end) {
      out.push({ scope: ev.scope, name: ev.name, reason: ev.reason });
    }
  }
  return out;
}

/**
 * Parse a JSON array into ScheduledEvents with minimal validation. Bad
 * entries are dropped and reported as warnings — one malformed entry
 * must not silence the entire calendar.
 */
export function parseScheduledEvents(text: string): {
  events: ScheduledEvent[];
  warnings: string[];
} {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return {
      events: [],
      warnings: [`parse: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
  if (!Array.isArray(raw)) {
    return { events: [], warnings: ["root: expected an array"] };
  }
  const events: ScheduledEvent[] = [];
  const warnings: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const e = raw[i];
    if (!isValidScheduledEvent(e)) {
      warnings.push(`#${i}: missing or invalid fields`);
      continue;
    }
    events.push(e);
  }
  return { events, warnings };
}

function isValidScheduledEvent(x: unknown): x is ScheduledEvent {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  if (typeof o.name !== "string") return false;
  if (typeof o.tsMs !== "number" || !Number.isFinite(o.tsMs)) return false;
  if (typeof o.reason !== "string") return false;
  if (o.scope !== "all") {
    if (typeof o.scope !== "object" || o.scope === null) return false;
    const s = o.scope as Record<string, unknown>;
    if (typeof s.ticker !== "string") return false;
  }
  return true;
}

/**
 * Read the shared blackouts file and derive the active list for `nowMs`.
 * Returns an empty list if the file is missing or unparseable — this is
 * a soft dependency, the sidecar must not crash on a skill-writer bug.
 */
export function loadActiveBlackouts(
  path: string,
  nowMs: number,
): { active: ActiveBlackout[]; warnings: string[] } {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err ? (err as { code?: unknown }).code : undefined;
    if (code === "ENOENT") {
      // Absent file is the normal state — no warnings, no blackouts.
      return { active: [], warnings: [] };
    }
    return {
      active: [],
      warnings: [`read: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
  const { events, warnings } = parseScheduledEvents(text);
  return { active: activeAt(events, nowMs), warnings };
}

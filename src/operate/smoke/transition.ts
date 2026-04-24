/**
 * State-transition detection for smoke runs. Pure function — given the
 * previous smoke state and the current report, return the transitions
 * worth notifying the user about.
 *
 * Notification rules:
 *   - `new-failure`     — tool was ok in previous state, now failing.
 *   - `recovered`       — tool was failing in previous state, now ok.
 *   - `still-failing-notify` — tool has been failing continuously; emit
 *     at streak milestones (1, 10, 100, 1000) so a prolonged outage
 *     gets renotified without spamming on every tick. Streak=1 is
 *     covered by `new-failure`; later milestones fire from this path.
 *
 * Consecutive failures tracked in a streak map that's returned
 * alongside the transitions — caller persists it into the next state.
 */

import type { SmokeReport, SmokeState, SmokeTransition } from "./types.js";

/** Streak milestones at which we renotify a still-failing tool. */
const RENOTIFY_STREAKS = new Set<number>([10, 100, 1000]);

export interface TransitionOutput {
  readonly transitions: readonly SmokeTransition[];
  /** Updated streak map to persist with the new state. */
  readonly streaks: Readonly<Record<string, number>>;
}

/**
 * Compare a fresh SmokeReport against the previous SmokeState and
 * compute transitions + updated streak counts.
 *
 * When `previousState` is undefined (first-ever run), every failure is
 * reported as a `new-failure` — you want to see the initial state.
 */
export function detectTransitions(
  current: SmokeReport,
  previousState: SmokeState | undefined,
): TransitionOutput {
  const transitions: SmokeTransition[] = [];
  const streaks: Record<string, number> = {};

  const previousResults = new Map(
    (previousState?.lastReport.results ?? []).map((r) => [r.tool, r]),
  );
  const previousStreaks = previousState?.streaks ?? {};

  for (const result of current.results) {
    const wasOk = previousResults.get(result.tool)?.ok ?? true; // treat missing-from-previous as ok (fresh tool)
    const priorStreak = previousStreaks[result.tool] ?? 0;

    if (result.ok) {
      streaks[result.tool] = 0;
      if (!wasOk) {
        transitions.push({ tool: result.tool, kind: "recovered" });
      }
      continue;
    }

    // Failing now.
    const nextStreak = priorStreak + 1;
    streaks[result.tool] = nextStreak;
    const reason = result.stderr || `exit ${result.exitCode}`;

    if (wasOk) {
      // ok → fail transition (streak was 0 or missing, now 1)
      transitions.push({ tool: result.tool, kind: "new-failure", reason, streakCount: nextStreak });
    } else if (RENOTIFY_STREAKS.has(nextStreak)) {
      // Prolonged outage milestone — renotify.
      transitions.push({ tool: result.tool, kind: "still-failing-notify", reason, streakCount: nextStreak });
    }
    // else: still failing but not at a milestone — silent to avoid spam.
  }

  return { transitions, streaks };
}

/**
 * Format a transition list as a Telegram-friendly message. Kept pure
 * and small so it's easy to unit-test the exact wording.
 */
export function formatTransitionsForTelegram(
  transitions: readonly SmokeTransition[],
  container: string,
): string {
  if (transitions.length === 0) return "";

  const lines: string[] = [];
  const failures = transitions.filter((t) => t.kind !== "recovered");
  const recoveries = transitions.filter((t) => t.kind === "recovered");

  if (failures.length > 0) {
    lines.push(`⚠️ Tool smoke — ${failures.length} failing on \`${container}\``);
    for (const t of failures) {
      const streakNote = t.streakCount && t.streakCount > 1 ? ` (streak: ${t.streakCount})` : "";
      const reason = t.reason ? ` — ${t.reason.slice(0, 80)}` : "";
      lines.push(`  • \`${t.tool}\`${streakNote}${reason}`);
    }
  }
  if (recoveries.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`✅ Recovered — ${recoveries.length} tool(s)`);
    for (const t of recoveries) {
      lines.push(`  • \`${t.tool}\``);
    }
  }

  return lines.join("\n");
}

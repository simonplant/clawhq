/**
 * Repair watcher — continuous health monitoring with auto-repair.
 *
 * Runs repair checks on an interval, auto-recovering from common
 * failures (network drops, Gateway crashes, bridge interface changes).
 * Stops on AbortSignal or explicit stop().
 */

import { runRepair } from "./runner.js";
import type { RepairConfig, RepairContext, RepairReport } from "./types.js";
import { DEFAULT_REPAIR_CONFIG } from "./types.js";

export interface WatcherOptions {
  ctx: RepairContext;
  config?: RepairConfig;
  /** Interval between repair cycles in milliseconds. Default: 30_000 (30s). */
  intervalMs?: number;
  /** Called after each repair cycle completes. */
  onCycle?: (report: RepairReport) => void;
  /** Called when a repair cycle throws an unexpected error. */
  onError?: (error: Error) => void;
}

export interface RepairWatcher {
  /** Stop the watcher. */
  stop(): void;
  /** Promise that resolves when the watcher stops. */
  done: Promise<void>;
}

/**
 * Start continuous health monitoring with auto-repair.
 *
 * Runs an initial repair cycle immediately, then repeats on the
 * configured interval. Stops when the AbortSignal fires or stop() is called.
 */
export function startWatcher(options: WatcherOptions): RepairWatcher {
  const {
    ctx,
    config = DEFAULT_REPAIR_CONFIG,
    intervalMs = 30_000,
    onCycle,
    onError,
  } = options;

  const ac = new AbortController();

  // Merge signals: respect both caller's signal and our own stop()
  const callerSignal = ctx.signal;
  if (callerSignal) {
    if (callerSignal.aborted) {
      ac.abort();
    } else {
      callerSignal.addEventListener("abort", () => ac.abort(), { once: true });
    }
  }

  const mergedCtx: RepairContext = { ...ctx, signal: ac.signal };

  const done = (async () => {
    while (!ac.signal.aborted) {
      try {
        const report = await runRepair(mergedCtx, config);
        onCycle?.(report);
      } catch (err: unknown) {
        if (ac.signal.aborted) break;
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }

      if (ac.signal.aborted) break;

      // Wait for interval or abort
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, intervalMs);
        const onAbort = () => {
          clearTimeout(timer);
          resolve();
        };
        ac.signal.addEventListener("abort", onAbort, { once: true });
      });
    }
  })();

  return {
    stop() {
      ac.abort();
    },
    done,
  };
}

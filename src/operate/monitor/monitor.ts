/**
 * Monitor daemon — background health loop with alerts, recovery, and digest.
 *
 * Ties together all monitor components into a single polling loop:
 * 1. Collect resource samples
 * 2. Check container health
 * 3. Analyze trends and fire predictive alerts
 * 4. Auto-recover from container-down / OOM
 * 5. Send notifications for critical alerts
 * 6. Deliver daily digest at configured hour
 *
 * Runs until AbortSignal fires. Never throws.
 */

import { runLifecycle } from "../../evolve/memory/lifecycle.js";

import { analyzeHealth, checkContainerHealth, collectSample } from "./alerts.js";
import { buildDigest, sendDigest } from "./digest.js";
import { sendNotification } from "./notify.js";
import { MONITOR_HEALTH_INTERVAL_MS, MONITOR_MEMORY_LIFECYCLE_INTERVAL_MS } from "../../config/defaults.js";

import { attemptRecovery, RecoveryTracker } from "./recovery.js";
import type {
  HealthAlert,
  MonitorEvent,
  MonitorOptions,
  MonitorState,
  RecoveryResult,
  ResourceSample,
} from "./types.js";

// ── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_DIGEST_HOUR = 8;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Start the monitor daemon.
 *
 * Runs a polling loop that checks agent health, fires alerts, auto-recovers,
 * and delivers daily digests. Stops when signal is aborted.
 */
export async function startMonitor(options: MonitorOptions): Promise<MonitorState> {
  const intervalMs = options.intervalMs ?? MONITOR_HEALTH_INTERVAL_MS;
  const digestHour = options.notify?.digestHour ?? DEFAULT_DIGEST_HOUR;
  const startedAt = new Date().toISOString();

  // Accumulated state
  const samples: ResourceSample[] = [];
  const allAlerts: HealthAlert[] = [];
  const allRecoveries: RecoveryResult[] = [];
  const tracker = new RecoveryTracker();
  let digestSentToday = false;
  let lastDigestDate = "";
  let lastMemoryLifecycleAt = 0;
  const memoryLifecycleIntervalMs =
    options.memoryLifecycle?.intervalMs ?? MONITOR_MEMORY_LIFECYCLE_INTERVAL_MS;

  const emit = (type: MonitorEvent["type"], message: string, data?: unknown): void => {
    options.onEvent?.({
      type,
      timestamp: new Date().toISOString(),
      message,
      data,
    });
  };

  emit("started", "Monitor daemon started", { intervalMs, digestHour });

  const tick = async (): Promise<void> => {
    try {
      // 1. Collect resource sample
      const sample = await collectSample(options.deployDir, options.signal);
      if (sample) {
        samples.push(sample);
        // Keep last 1000 samples (~8h at 30s intervals)
        if (samples.length > 1000) samples.splice(0, samples.length - 1000);
      }

      // 2. Check container health (down/OOM detection)
      const containerAlerts = await checkContainerHealth(
        options.deployDir,
        options.signal,
      );

      // 3. Analyze trends for predictive alerts
      const { alerts: trendAlerts } = analyzeHealth(samples, options.thresholds);

      const tickAlerts = [...containerAlerts, ...trendAlerts];
      allAlerts.push(...tickAlerts);

      // Prune old alerts/recoveries (keep last 48h)
      const cutoff48h = Date.now() - 2 * 86_400_000;
      while (allAlerts.length > 0 && new Date(allAlerts[0].timestamp).getTime() < cutoff48h) {
        allAlerts.shift();
      }
      while (allRecoveries.length > 0 && new Date(allRecoveries[0].timestamp).getTime() < cutoff48h) {
        allRecoveries.shift();
      }

      emit("tick", `Health check: ${tickAlerts.length} alert(s)`, {
        alerts: tickAlerts.length,
        sample,
      });

      // 4. Auto-recovery for container-down / OOM
      if (containerAlerts.length > 0) {
        const recoveries = await attemptRecovery(
          options.deployDir,
          containerAlerts,
          tracker,
          options.recovery,
          options.signal,
        );

        for (const r of recoveries) {
          allRecoveries.push(r);
          const category = r.success ? "recovery-succeeded" : "recovery-failed";
          emit("recovery", r.message, r);

          // Notify on recovery attempts
          if (options.notify?.channels) {
            const alertMsg = r.success
              ? `Auto-recovery succeeded: ${r.action} (${r.durationMs}ms)`
              : `Auto-recovery failed: ${r.message}`;
            const severity = r.success ? "info" : "critical";
            allAlerts.push({
              id: `rec-${Date.now()}`,
              timestamp: r.timestamp,
              severity,
              category,
              message: alertMsg,
            });
          }
        }
      }

      // 5. Notify on critical alerts
      if (options.notify?.alertsEnabled !== false && options.notify?.channels) {
        const criticals = tickAlerts.filter((a) => a.severity === "critical");
        for (const alert of criticals) {
          const results = await sendNotification(
            options.notify.channels,
            `Alert: ${alert.category}`,
            alert.message + (alert.detail ? `\n${alert.detail}` : ""),
          );
          emit("notify", `Alert notification sent to ${results.length} channel(s)`, results);
        }
      }

      // 6. Scheduled memory lifecycle
      if (options.memoryLifecycle?.enabled) {
        const elapsed = Date.now() - lastMemoryLifecycleAt;
        if (elapsed >= memoryLifecycleIntervalMs) {
          try {
            emit("memory-lifecycle", "Running scheduled memory lifecycle...");
            const lifecycleResult = await runLifecycle({
              deployDir: options.deployDir,
            });
            lastMemoryLifecycleAt = Date.now();
            emit(
              "memory-lifecycle",
              `Memory lifecycle complete: ${lifecycleResult.transitions.length} transitions, ${lifecycleResult.purged.length} purged`,
              {
                transitions: lifecycleResult.transitions.length,
                purged: lifecycleResult.purged.length,
                totalEntries: lifecycleResult.totalEntries,
              },
            );
          } catch (err) {
            emit(
              "error",
              `Memory lifecycle error: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }

      // 7. Daily digest
      if (options.notify?.digestEnabled !== false && options.notify?.channels) {
        const now = new Date();
        const todayDate = now.toISOString().slice(0, 10);
        const currentHour = now.getHours();

        // Reset digest flag at midnight
        if (todayDate !== lastDigestDate) {
          digestSentToday = false;
          lastDigestDate = todayDate;
        }

        if (currentHour >= digestHour && !digestSentToday) {
          const digest = buildDigest(
            allAlerts,
            allRecoveries,
            sample,
            startedAt,
          );

          const results = await sendDigest(options.notify.channels, digest);
          digestSentToday = true;
          emit("digest", "Daily digest sent", { digest: digest.summary, results });
        }
      }
    } catch (err) {
      emit("error", `Monitor tick error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Run the loop
  await tick();

  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (options.signal?.aborted) {
        clearInterval(timer);
        resolve();
        return;
      }
      void tick();
    }, intervalMs);

    options.signal?.addEventListener("abort", () => {
      clearInterval(timer);
      resolve();
    }, { once: true });
  });

  emit("stopped", "Monitor daemon stopped");

  return {
    running: false,
    startedAt,
    lastCheck: new Date().toISOString(),
    alertsToday: allAlerts.filter(
      (a) => new Date(a.timestamp).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10),
    ).length,
    recoveriesToday: allRecoveries.filter(
      (r) => new Date(r.timestamp).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10),
    ).length,
    digestSentToday,
  };
}

/**
 * Auto-recovery for container stopped and OOM cases.
 *
 * Handles the common failure modes without user intervention:
 * - Container stopped → restart via docker compose
 * - Container OOM killed → restart with same compose config
 *
 * Conservative approach: rate-limited, cooldown between attempts, max attempts
 * per hour. Never escalates — just restarts and reports.
 *
 * AC: "Auto-recovery handles container restart and OOM cases"
 */

import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import type { HealthAlert, RecoveryPolicy, RecoveryResult } from "./types.js";

const execFileAsync = promisify(execFile);
const EXEC_TIMEOUT_MS = 30_000;

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_POLICY: Required<RecoveryPolicy> = {
  enabled: true,
  maxAttemptsPerHour: 3,
  cooldownMs: 60_000,
};

// ── Recovery State ──────────────────────────────────────────────────────────

/** Tracks recent recovery attempts for rate limiting. */
export class RecoveryTracker {
  private readonly attempts: { timestamp: number; action: string }[] = [];
  private lastAttemptTime = 0;

  /**
   * Check if a recovery attempt is allowed under the current policy.
   */
  canAttempt(policy?: RecoveryPolicy): boolean {
    const p = { ...DEFAULT_POLICY, ...policy };
    if (!p.enabled) return false;

    const now = Date.now();

    // Cooldown check
    if (now - this.lastAttemptTime < p.cooldownMs) return false;

    // Rate limit: max attempts per hour
    const oneHourAgo = now - 3_600_000;
    const recentAttempts = this.attempts.filter((a) => a.timestamp > oneHourAgo);
    return recentAttempts.length < p.maxAttemptsPerHour;
  }

  /** Record a recovery attempt. */
  record(action: string): void {
    this.lastAttemptTime = Date.now();
    this.attempts.push({ timestamp: Date.now(), action });

    // Prune old entries (keep last 24h)
    const cutoff = Date.now() - 86_400_000;
    while (this.attempts.length > 0 && this.attempts[0].timestamp < cutoff) {
      this.attempts.shift();
    }
  }

  /** Get count of attempts in the last hour. */
  get recentCount(): number {
    const oneHourAgo = Date.now() - 3_600_000;
    return this.attempts.filter((a) => a.timestamp > oneHourAgo).length;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Attempt auto-recovery based on fired alerts.
 *
 * Handles:
 * - container-down → docker compose restart
 * - container-oom → docker compose restart (compose config has mem limits)
 *
 * Returns recovery results. Never throws.
 */
export async function attemptRecovery(
  deployDir: string,
  alerts: readonly HealthAlert[],
  tracker: RecoveryTracker,
  policy?: RecoveryPolicy,
  signal?: AbortSignal,
): Promise<RecoveryResult[]> {
  const results: RecoveryResult[] = [];
  const p = { ...DEFAULT_POLICY, ...policy };

  if (!p.enabled) return results;

  for (const alert of alerts) {
    if (alert.category === "container-down" || alert.category === "container-oom") {
      if (!tracker.canAttempt(policy)) {
        results.push({
          action: alert.category === "container-oom" ? "oom-restart" : "container-restart",
          success: false,
          timestamp: new Date().toISOString(),
          message: `Recovery skipped — rate limit reached (${tracker.recentCount} attempts in last hour)`,
          durationMs: 0,
        });
        continue;
      }

      const action = alert.category === "container-oom" ? "oom-restart" : "container-restart";
      const result = await restartContainer(deployDir, action, signal);
      tracker.record(action);
      results.push(result);

      // Only attempt one restart per tick
      break;
    }
  }

  return results;
}

// ── Internal ────────────────────────────────────────────────────────────────

async function restartContainer(
  deployDir: string,
  action: RecoveryResult["action"],
  signal?: AbortSignal,
): Promise<RecoveryResult> {
  const start = Date.now();
  const composePath = join(deployDir, "engine", "docker-compose.yml");

  try {
    // Stop first (handles stuck containers)
    await execFileAsync(
      "docker",
      ["compose", "-f", composePath, "down", "--timeout", "10"],
      { timeout: EXEC_TIMEOUT_MS, signal },
    ).catch((e) => {
      console.warn(`[recovery] Docker compose down failed (container may already be stopped):`, e);
    });

    // Start
    await execFileAsync(
      "docker",
      ["compose", "-f", composePath, "up", "-d"],
      { timeout: EXEC_TIMEOUT_MS, signal },
    );

    // Quick health check — wait a few seconds for container to be running
    await new Promise((resolve) => setTimeout(resolve, 5_000));

    const { stdout } = await execFileAsync(
      "docker",
      ["compose", "-f", composePath, "ps", "--format", "json"],
      { timeout: EXEC_TIMEOUT_MS, signal },
    );

    const running = stdout.includes('"running"');
    const durationMs = Date.now() - start;

    if (running) {
      return {
        action,
        success: true,
        timestamp: new Date().toISOString(),
        message: `Container restarted successfully (${action})`,
        durationMs,
      };
    }

    return {
      action,
      success: false,
      timestamp: new Date().toISOString(),
      message: "Container started but not in running state",
      durationMs,
    };
  } catch (err) {
    return {
      action,
      success: false,
      timestamp: new Date().toISOString(),
      message: `Recovery failed: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - start,
    };
  }
}

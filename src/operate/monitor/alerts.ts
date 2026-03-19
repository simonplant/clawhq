/**
 * Predictive health alerts based on resource trends.
 *
 * Collects resource samples over time and uses linear regression on the
 * sliding window to predict resource exhaustion. Fires alerts before
 * failures happen — not after.
 *
 * AC: "Health alerts fire before service goes down"
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { promisify } from "node:util";

import { GATEWAY_DEFAULT_PORT } from "../../config/defaults.js";

import type {
  AlertSeverity,
  AlertThresholds,
  HealthAlert,
  ResourceSample,
  ResourceTrend,
} from "./types.js";

const execFileAsync = promisify(execFile);
const EXEC_TIMEOUT_MS = 10_000;

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLDS: Required<AlertThresholds> = {
  diskWarningPercent: 80,
  diskCriticalPercent: 90,
  memoryWarningPercent: 85,
  cpuSustainedPercent: 90,
  trendWindowSize: 10,
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Collect a resource sample from the running container and host.
 *
 * Never throws — returns null if collection fails.
 */
export async function collectSample(
  deployDir: string,
  signal?: AbortSignal,
): Promise<ResourceSample | null> {
  try {
    const [containerStats, diskStats] = await Promise.all([
      getContainerStats(deployDir, signal),
      getDiskStats(deployDir, signal),
    ]);

    return {
      timestamp: new Date().toISOString(),
      cpuPercent: containerStats?.cpuPercent ?? 0,
      memoryMb: containerStats?.memoryMb ?? 0,
      memoryLimitMb: containerStats?.memoryLimitMb ?? 0,
      diskUsedPercent: diskStats?.usedPercent ?? 0,
      diskFreeMb: diskStats?.freeMb ?? 0,
    };
  } catch (e) {
    console.warn(`[monitor:alerts] Failed to collect resource sample:`, e);
    return null;
  }
}

/**
 * Analyze resource samples for threshold violations and predictive trends.
 *
 * Returns alerts for:
 * - Disk usage exceeding warning/critical thresholds
 * - Memory usage exceeding threshold
 * - Sustained CPU usage
 * - Trend-based predictions of resource exhaustion
 */
export function analyzeHealth(
  samples: readonly ResourceSample[],
  thresholds?: AlertThresholds,
): { alerts: HealthAlert[]; trends: ResourceTrend[] } {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const alerts: HealthAlert[] = [];
  const trends: ResourceTrend[] = [];

  if (samples.length === 0) return { alerts, trends };

  const latest = samples[samples.length - 1];

  // ── Threshold Alerts ────────────────────────────────────────────────────

  if (latest.diskUsedPercent >= t.diskCriticalPercent) {
    alerts.push(createAlert(
      "critical",
      "disk-critical",
      `Disk usage critical: ${latest.diskUsedPercent}% (${latest.diskFreeMb}MB free)`,
    ));
  } else if (latest.diskUsedPercent >= t.diskWarningPercent) {
    alerts.push(createAlert(
      "warning",
      "disk-warning",
      `Disk usage high: ${latest.diskUsedPercent}% (${latest.diskFreeMb}MB free)`,
    ));
  }

  if (latest.memoryLimitMb > 0) {
    const memPercent = (latest.memoryMb / latest.memoryLimitMb) * 100;
    if (memPercent >= t.memoryWarningPercent) {
      alerts.push(createAlert(
        "warning",
        "memory-growth",
        `Memory usage high: ${latest.memoryMb}MB / ${latest.memoryLimitMb}MB (${memPercent.toFixed(0)}%)`,
      ));
    }
  }

  // ── Trend Analysis ──────────────────────────────────────────────────────

  const window = samples.slice(-t.trendWindowSize);
  if (window.length >= 3) {
    // Disk trend
    const diskTrend = analyzeTrend(
      window.map((s) => s.diskUsedPercent),
      "disk",
      latest.diskUsedPercent,
      100,
    );
    trends.push(diskTrend);
    if (diskTrend.alert) alerts.push(diskTrend.alert);

    // Memory trend
    if (latest.memoryLimitMb > 0) {
      const memTrend = analyzeTrend(
        window.map((s) => (s.memoryMb / s.memoryLimitMb) * 100),
        "memory",
        (latest.memoryMb / latest.memoryLimitMb) * 100,
        100,
      );
      trends.push(memTrend);
      if (memTrend.alert) alerts.push(memTrend.alert);
    }

    // CPU trend (sustained high)
    const avgCpu = window.reduce((sum, s) => sum + s.cpuPercent, 0) / window.length;
    if (avgCpu >= t.cpuSustainedPercent) {
      alerts.push(createAlert(
        "warning",
        "cpu-sustained",
        `Sustained CPU usage: ${avgCpu.toFixed(0)}% average over ${window.length} samples`,
      ));
    }
    trends.push({
      metric: "cpu",
      slope: linearSlope(window.map((s) => s.cpuPercent)),
      currentValue: latest.cpuPercent,
    });
  }

  return { alerts, trends };
}

/**
 * Check if the container is running and detect OOM kills.
 *
 * Returns alerts for container-down and container-oom states.
 */
export async function checkContainerHealth(
  deployDir: string,
  signal?: AbortSignal,
): Promise<HealthAlert[]> {
  const alerts: HealthAlert[] = [];

  try {
    const composePath = join(deployDir, "engine", "docker-compose.yml");
    const { stdout } = await execFileAsync(
      "docker",
      ["compose", "-f", composePath, "ps", "--format", "json"],
      { timeout: EXEC_TIMEOUT_MS, signal },
    );

    if (!stdout.trim()) {
      alerts.push(createAlert("critical", "container-down", "Agent container is not running"));
      return alerts;
    }

    const lines = stdout.trim().split("\n");
    const svc = JSON.parse(lines[0]) as {
      State?: string;
      Health?: string;
      ExitCode?: number;
      Status?: string;
    };

    if (svc.State !== "running") {
      // Check for OOM via exit code 137 or status
      const isOom = svc.ExitCode === 137 || svc.Status?.includes("OOMKilled");
      if (isOom) {
        alerts.push(createAlert(
          "critical",
          "container-oom",
          "Agent container killed by OOM (out of memory)",
          `Exit code: ${svc.ExitCode}`,
        ));
      } else {
        alerts.push(createAlert(
          "critical",
          "container-down",
          `Agent container is ${svc.State ?? "stopped"}`,
          svc.ExitCode != null ? `Exit code: ${svc.ExitCode}` : undefined,
        ));
      }
    }
  } catch (e) {
    console.warn(`[monitor:alerts] Failed to check container health:`, e);
    alerts.push(createAlert("critical", "container-down", "Cannot reach Docker — agent container status unknown"));
  }

  // Gateway reachability
  try {
    await execFileAsync(
      "curl",
      ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "5", `http://localhost:${GATEWAY_DEFAULT_PORT}`],
      { timeout: EXEC_TIMEOUT_MS, signal },
    );
  } catch (e) {
    console.warn(`[monitor:alerts] Failed to reach gateway:`, e);
    alerts.push(createAlert("warning", "gateway-unreachable", `Gateway not responding on port ${GATEWAY_DEFAULT_PORT}`));
  }

  return alerts;
}

// ── Internal ────────────────────────────────────────────────────────────────

function createAlert(
  severity: AlertSeverity,
  category: HealthAlert["category"],
  message: string,
  detail?: string,
): HealthAlert {
  return {
    id: randomUUID().slice(0, 8),
    timestamp: new Date().toISOString(),
    severity,
    category,
    message,
    detail,
  };
}

async function getContainerStats(
  deployDir: string,
  signal?: AbortSignal,
): Promise<{ cpuPercent: number; memoryMb: number; memoryLimitMb: number } | null> {
  try {
    const composePath = join(deployDir, "engine", "docker-compose.yml");

    // Get container name
    const { stdout: psOut } = await execFileAsync(
      "docker",
      ["compose", "-f", composePath, "ps", "-q"],
      { timeout: EXEC_TIMEOUT_MS, signal },
    );

    const containerId = psOut.trim().split("\n")[0];
    if (!containerId) return null;

    // Get stats
    const { stdout: statsOut } = await execFileAsync(
      "docker",
      ["stats", "--no-stream", "--format", "{{.CPUPerc}}|{{.MemUsage}}", containerId],
      { timeout: EXEC_TIMEOUT_MS, signal },
    );

    const parts = statsOut.trim().split("|");
    if (parts.length < 2) return null;

    const cpuPercent = parseFloat(parts[0].replace("%", "")) || 0;
    const memParts = parts[1].split("/").map((s) => s.trim());
    const memoryMb = parseMem(memParts[0]);
    const memoryLimitMb = parseMem(memParts[1]);

    return { cpuPercent, memoryMb, memoryLimitMb };
  } catch (e) {
    console.warn(`[monitor:alerts] Failed to get container stats:`, e);
    return null;
  }
}

function parseMem(str: string): number {
  if (!str) return 0;
  const value = parseFloat(str);
  if (isNaN(value)) return 0;
  if (str.includes("GiB")) return value * 1024;
  if (str.includes("MiB")) return value;
  if (str.includes("KiB")) return value / 1024;
  return value;
}

async function getDiskStats(
  deployDir: string,
  signal?: AbortSignal,
): Promise<{ usedPercent: number; freeMb: number } | null> {
  try {
    const { stdout } = await execFileAsync(
      "df",
      ["--output=avail,pcent", "-BM", deployDir],
      { timeout: EXEC_TIMEOUT_MS, signal },
    );

    const lines = stdout.trim().split("\n");
    if (lines.length < 2) return null;

    const parts = lines[1].trim().split(/\s+/);
    if (parts.length < 2) return null;

    const freeMb = parseInt(parts[0].replace("M", ""), 10);
    const usedPercent = parseInt(parts[1].replace("%", ""), 10);

    if (isNaN(freeMb) || isNaN(usedPercent)) return null;
    return { usedPercent, freeMb };
  } catch (e) {
    console.warn(`[monitor:alerts] Failed to get disk stats:`, e);
    return null;
  }
}

/** Simple linear regression slope over equally-spaced values. */
function linearSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return 0;

  return (n * sumXY - sumX * sumY) / denominator;
}

/** Analyze trend for a metric and predict exhaustion. */
function analyzeTrend(
  values: number[],
  metric: ResourceTrend["metric"],
  currentValue: number,
  maxValue: number,
): ResourceTrend {
  const slope = linearSlope(values);

  // Only predict exhaustion if trend is upward
  if (slope > 0.1 && currentValue < maxValue) {
    const remaining = maxValue - currentValue;
    const samplesUntilExhaustion = remaining / slope;
    // Each sample is roughly 30s apart (monitor interval)
    const minutesUntilExhaustion = (samplesUntilExhaustion * 30) / 60;

    if (minutesUntilExhaustion < 60) {
      return {
        metric,
        slope,
        currentValue,
        predictedExhaustion: `~${Math.round(minutesUntilExhaustion)} minutes`,
        alert: createAlert(
          "warning",
          metric === "disk" ? "disk-warning" : "memory-growth",
          `${metric} exhaustion predicted in ~${Math.round(minutesUntilExhaustion)} minutes (slope: ${slope.toFixed(2)}/sample)`,
        ),
      };
    }
  }

  return { metric, slope, currentValue };
}

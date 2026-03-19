/**
 * Status dashboard — gathers agent state from Docker, Gateway, config, and disk.
 *
 * `clawhq status` shows a single-pane view. `clawhq status --watch` refreshes
 * on interval. Never throws — all errors are captured in the snapshot.
 */

import { execFile } from "node:child_process";
import { access, constants, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type {
  ContainerStatus,
  DiskUsage,
  GatewayStatus,
  StatusOptions,
  StatusSnapshot,
  StatusWatchOptions,
} from "./types.js";

const execFileAsync = promisify(execFile);

const EXEC_TIMEOUT_MS = 10_000;
const DEFAULT_WATCH_INTERVAL_MS = 5_000;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Gather a single status snapshot.
 *
 * Runs all checks in parallel. Never throws — errors are captured per section.
 */
export async function getStatus(options: StatusOptions): Promise<StatusSnapshot> {
  const { deployDir, signal } = options;

  const [container, gateway, config, disk] = await Promise.all([
    getContainerStatus(deployDir, signal),
    getGatewayStatus(signal),
    getConfigStatus(deployDir),
    getDiskUsage(deployDir, signal),
  ]);

  const healthy =
    (container?.running ?? false) &&
    gateway.reachable &&
    config.valid;

  return {
    timestamp: new Date().toISOString(),
    container,
    gateway,
    configValid: config.valid,
    configErrors: config.errors,
    disk,
    healthy,
  };
}

/**
 * Watch mode — calls onUpdate on interval until signal is aborted.
 *
 * Does an immediate update, then repeats on interval.
 */
export async function watchStatus(options: StatusWatchOptions): Promise<void> {
  const intervalMs = options.intervalMs ?? DEFAULT_WATCH_INTERVAL_MS;

  const tick = async (): Promise<void> => {
    const snapshot = await getStatus(options);
    options.onUpdate(snapshot);
  };

  // Immediate first update
  await tick();

  return new Promise<void>((resolve) => {
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
}

// ── Internal Checks ─────────────────────────────────────────────────────────

async function getContainerStatus(
  deployDir: string,
  signal?: AbortSignal,
): Promise<ContainerStatus | null> {
  try {
    const composePath = join(deployDir, "engine", "docker-compose.yml");
    const { stdout } = await execFileAsync(
      "docker",
      ["compose", "-f", composePath, "ps", "--format", "json"],
      { timeout: EXEC_TIMEOUT_MS, signal },
    );

    if (!stdout.trim()) return null;

    // docker compose ps --format json outputs one JSON object per line
    const lines = stdout.trim().split("\n");
    const first = lines[0];
    const svc = JSON.parse(first) as {
      Name?: string;
      Image?: string;
      State?: string;
      Health?: string;
      RunningFor?: string;
      Status?: string;
    };

    return {
      running: svc.State === "running",
      name: svc.Name ?? "unknown",
      image: svc.Image ?? "unknown",
      state: svc.State ?? "unknown",
      health: svc.Health ?? "none",
      startedAt: svc.RunningFor ?? svc.Status ?? "unknown",
    };
  } catch {
    return null;
  }
}

async function getGatewayStatus(signal?: AbortSignal): Promise<GatewayStatus> {
  const start = Date.now();
  try {
    await execFileAsync(
      "curl",
      ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "5", "http://localhost:18789"],
      { timeout: EXEC_TIMEOUT_MS, signal },
    );
    return {
      reachable: true,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      reachable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function getConfigStatus(
  deployDir: string,
): Promise<{ valid: boolean; errors: string[] }> {
  const configPath = join(deployDir, "engine", "openclaw.json");
  const errors: string[] = [];

  try {
    await access(configPath, constants.R_OK);
  } catch {
    return { valid: false, errors: ["Config file not found"] };
  }

  try {
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;

    // Quick landmine spot-checks
    if (config["dangerouslyDisableDeviceAuth"] !== true) {
      errors.push("LM-01: dangerouslyDisableDeviceAuth not set");
    }
    if (!Array.isArray(config["allowedOrigins"]) || (config["allowedOrigins"] as unknown[]).length === 0) {
      errors.push("LM-02: allowedOrigins empty or missing");
    }
    if (!Array.isArray(config["trustedProxies"]) || (config["trustedProxies"] as unknown[]).length === 0) {
      errors.push("LM-03: trustedProxies empty or missing");
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "Invalid JSON");
  }

  return { valid: errors.length === 0, errors };
}

async function getDiskUsage(
  deployDir: string,
  signal?: AbortSignal,
): Promise<DiskUsage | null> {
  try {
    // Check deploy dir exists first
    await stat(deployDir);

    const { stdout } = await execFileAsync(
      "df",
      ["--output=size,avail,pcent", "-BM", deployDir],
      { timeout: EXEC_TIMEOUT_MS, signal },
    );

    const lines = stdout.trim().split("\n");
    if (lines.length < 2) return null;

    const parts = lines[1].trim().split(/\s+/);
    if (parts.length < 3) return null;

    const totalMb = parseInt(parts[0].replace("M", ""), 10);
    const freeMb = parseInt(parts[1].replace("M", ""), 10);
    const usedPercent = parseInt(parts[2].replace("%", ""), 10);

    if (isNaN(totalMb) || isNaN(freeMb) || isNaN(usedPercent)) return null;

    return { totalMb, freeMb, usedPercent };
  } catch {
    return null;
  }
}

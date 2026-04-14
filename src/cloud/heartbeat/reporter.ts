/**
 * Outbound health reporter (heartbeat).
 *
 * Collects health status and reports it outbound. Agent-initiated only —
 * the cloud never reaches in. Reports operational metadata, never content.
 *
 * What we report: container health, integration count, memory tier sizes,
 * disk usage. What we never report: conversations, memory contents,
 * credential values, identity files.
 */

import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statfsSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { CLOUD_HEARTBEAT_RPC_TIMEOUT_MS, DIR_MODE_SECRET, FILE_MODE_SECRET } from "../../config/defaults.js";
import {
  DEPLOY_CLOUD_SUBDIR,
  DEPLOY_ENGINE_COMPOSE_FILE,
  DEPLOY_ENGINE_CREDENTIALS_JSON,
  DEPLOY_ENGINE_SUBDIR,
  DEPLOY_WORKSPACE_MEMORY_DIR,
  DEPLOY_WORKSPACE_SUBDIR,
} from "../../config/paths.js";
import type { TrustMode } from "../../config/types.js";
import type { HeartbeatResult, HeartbeatState, HealthReport } from "../types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const execFileAsync = promisify(execFile);
const HEARTBEAT_FILE = "heartbeat.json";
const CONTAINER_CHECK_TIMEOUT_MS = 10_000;

// ── Path helpers ─────────────────────────────────────────────────────────────

/** Resolve heartbeat.json path for a deployment directory. */
export function heartbeatPath(deployDir: string): string {
  return join(deployDir, DEPLOY_CLOUD_SUBDIR, HEARTBEAT_FILE);
}

// ── State management ─────────────────────────────────────────────────────────

/** Read heartbeat state from disk. Returns default if file doesn't exist. */
export function readHeartbeatState(deployDir: string): HeartbeatState {
  const path = heartbeatPath(deployDir);
  if (!existsSync(path)) {
    return { version: 1, consecutiveFailures: 0 };
  }
  let parsed: Record<string, unknown>;
  try {
    const raw = readFileSync(path, "utf-8");
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { version: 1, consecutiveFailures: 0 };
  }
  if (parsed.version !== 1) {
    throw new Error(
      `Unsupported heartbeat state version ${String(parsed.version)} (expected 1). ` +
      `The state file at ${path} may have been created by a newer version of ClawHQ.`,
    );
  }
  return parsed as unknown as HeartbeatState;
}

/** Write heartbeat state atomically. */
function writeHeartbeatState(deployDir: string, state: HeartbeatState): void {
  const path = heartbeatPath(deployDir);
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: DIR_MODE_SECRET });
  }
  chmodSync(dir, DIR_MODE_SECRET);

  const content = JSON.stringify(state, null, 2) + "\n";
  const tmpName = `.heartbeat.tmp.${randomBytes(6).toString("hex")}`;
  const tmpPath = join(dir, tmpName);

  try {
    writeFileSync(tmpPath, content, { mode: FILE_MODE_SECRET });
    chmodSync(tmpPath, FILE_MODE_SECRET);
    renameSync(tmpPath, path);
  } catch (err) {
    // Write failed — heartbeat state is best-effort
    console.warn("[heartbeat] state write failed:", err instanceof Error ? err.message : String(err));
  }
}

// ── Health collection ────────────────────────────────────────────────────────

/**
 * Compute a stable agent ID from the deployment directory path.
 * This is a hash — it does not leak the actual path.
 */
function computeAgentId(deployDir: string): string {
  return createHash("sha256").update(deployDir).digest("hex").slice(0, 16);
}

/**
 * Get directory size in bytes. Returns 0 if directory doesn't exist.
 */
function dirSizeBytes(dirPath: string): number {
  if (!existsSync(dirPath)) return 0;
  let total = 0;
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isFile()) {
        total += statSync(fullPath).size;
      } else if (entry.isDirectory()) {
        total += dirSizeBytes(fullPath);
      }
    }
  } catch {
    // Best-effort size calculation
  }
  return total;
}

/**
 * Count integrations from credentials.json without reading credential values.
 */
function countIntegrations(deployDir: string): number {
  const credPath = join(deployDir, DEPLOY_ENGINE_SUBDIR, DEPLOY_ENGINE_CREDENTIALS_JSON);
  if (!existsSync(credPath)) return 0;
  try {
    const raw = readFileSync(credPath, "utf-8");
    const store = JSON.parse(raw) as { credentials?: readonly unknown[] };
    return store.credentials?.length ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Check if the container is actually running by querying Docker.
 * Falls back gracefully if Docker socket is unreachable.
 */
async function checkContainerRunning(
  deployDir: string,
): Promise<{ running: boolean; uptimeSeconds: number; error?: string }> {
  const composePath = join(deployDir, DEPLOY_ENGINE_SUBDIR, DEPLOY_ENGINE_COMPOSE_FILE);
  if (!existsSync(composePath)) {
    return { running: false, uptimeSeconds: -1 };
  }

  try {
    // Query actual container state via docker compose
    const { stdout } = await execFileAsync(
      "docker",
      ["compose", "-f", composePath, "ps", "--format", "json"],
      { timeout: CONTAINER_CHECK_TIMEOUT_MS },
    );

    if (!stdout.trim()) {
      return { running: false, uptimeSeconds: -1 };
    }

    // docker compose ps --format json outputs one JSON object per line
    const lines = stdout.trim().split("\n");
    const svc = JSON.parse(lines[0]) as { State?: string };

    if (svc.State !== "running") {
      return { running: false, uptimeSeconds: -1 };
    }

    // Container is running — get start time for uptime calculation
    const uptimeSeconds = await getContainerUptimeSeconds(composePath);
    return { running: true, uptimeSeconds };
  } catch (err) {
    // Docker socket unreachable or docker not installed — degrade gracefully
    return {
      running: false,
      uptimeSeconds: -1,
      error: `Docker unreachable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Get container uptime in seconds by inspecting container start time.
 * Returns 0 if start time cannot be determined.
 */
async function getContainerUptimeSeconds(composePath: string): Promise<number> {
  try {
    const { stdout: idOut } = await execFileAsync(
      "docker",
      ["compose", "-f", composePath, "ps", "-q"],
      { timeout: CONTAINER_CHECK_TIMEOUT_MS },
    );

    const containerId = idOut.trim().split("\n")[0];
    if (!containerId) return 0;

    const { stdout: inspectOut } = await execFileAsync(
      "docker",
      ["inspect", "--format", "{{.State.StartedAt}}", containerId],
      { timeout: CONTAINER_CHECK_TIMEOUT_MS },
    );

    const startedAt = inspectOut.trim();
    if (!startedAt) return 0;

    const startMs = new Date(startedAt).getTime();
    if (Number.isNaN(startMs)) return 0;

    return Math.max(0, Math.floor((Date.now() - startMs) / 1000));
  } catch {
    return 0;
  }
}

/**
 * Get disk usage percentage for the deploy directory's filesystem.
 * Uses Node.js statfsSync (available since Node 18.15).
 * Returns -1 if the filesystem query fails.
 */
function getDiskUsagePercent(deployDir: string): number {
  try {
    const stats = statfsSync(deployDir);
    const totalBlocks = stats.blocks;
    if (totalBlocks === 0) return -1;
    const usedBlocks = totalBlocks - stats.bavail;
    return Math.round((usedBlocks / totalBlocks) * 1000) / 10;
  } catch {
    return -1;
  }
}

/**
 * Collect a health report. Never includes content — only operational metadata.
 */
export async function collectHealthReport(
  deployDir: string,
  trustMode: TrustMode,
): Promise<HealthReport> {
  const container = await checkContainerRunning(deployDir);
  const memoryDir = join(deployDir, DEPLOY_WORKSPACE_SUBDIR, DEPLOY_WORKSPACE_MEMORY_DIR);

  return {
    agentId: computeAgentId(deployDir),
    trustMode,
    containerRunning: container.running,
    uptimeSeconds: container.uptimeSeconds,
    integrationCount: countIntegrations(deployDir),
    memoryTierSizes: {
      hot: dirSizeBytes(join(memoryDir, "hot")),
      warm: dirSizeBytes(join(memoryDir, "warm")),
      cold: dirSizeBytes(join(memoryDir, "cold")),
    },
    diskUsagePercent: getDiskUsagePercent(deployDir),
    timestamp: new Date().toISOString(),
  };
}

// ── Heartbeat execution ──────────────────────────────────────────────────────

/**
 * Send a heartbeat. Collects health data and posts it to the cloud endpoint.
 *
 * In paranoid mode, this is a no-op (blocked by trust mode policy).
 * The caller is responsible for checking trust mode before calling.
 */
export async function sendHeartbeat(
  deployDir: string,
  trustMode: TrustMode,
  cloudEndpoint?: string,
): Promise<HeartbeatResult> {
  const now = new Date().toISOString();
  const report = await collectHealthReport(deployDir, trustMode);

  if (!cloudEndpoint) {
    // No endpoint configured — collect report but don't send
    const state: HeartbeatState = {
      version: 1,
      lastSentAt: now,
      consecutiveFailures: 0,
    };
    writeHeartbeatState(deployDir, state);
    return { success: true, report, timestamp: now };
  }

  try {
    const response = await fetch(cloudEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(CLOUD_HEARTBEAT_RPC_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = `Heartbeat failed: HTTP ${response.status}`;
      const prev = readHeartbeatState(deployDir);
      writeHeartbeatState(deployDir, {
        version: 1,
        lastSentAt: prev.lastSentAt,
        consecutiveFailures: prev.consecutiveFailures + 1,
        lastError: error,
      });
      return { success: false, report, error, timestamp: now };
    }

    writeHeartbeatState(deployDir, {
      version: 1,
      lastSentAt: now,
      consecutiveFailures: 0,
    });
    return { success: true, report, timestamp: now };
  } catch (err) {
    const error = `Heartbeat failed: ${err instanceof Error ? err.message : String(err)}`;
    const prev = readHeartbeatState(deployDir);
    writeHeartbeatState(deployDir, {
      version: 1,
      lastSentAt: prev.lastSentAt,
      consecutiveFailures: prev.consecutiveFailures + 1,
      lastError: error,
    });
    return { success: false, report, error, timestamp: now };
  }
}

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

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { CLOUD_HEARTBEAT_RPC_TIMEOUT_MS } from "../../config/defaults.js";
import type { TrustMode } from "../../config/types.js";
import type { HeartbeatResult, HeartbeatState, HealthReport } from "../types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const HEARTBEAT_FILE = "heartbeat.json";

// ── Path helpers ─────────────────────────────────────────────────────────────

/** Resolve heartbeat.json path for a deployment directory. */
export function heartbeatPath(deployDir: string): string {
  return join(deployDir, "cloud", HEARTBEAT_FILE);
}

// ── State management ─────────────────────────────────────────────────────────

/** Read heartbeat state from disk. Returns default if file doesn't exist. */
export function readHeartbeatState(deployDir: string): HeartbeatState {
  const path = heartbeatPath(deployDir);
  if (!existsSync(path)) {
    return { version: 1, consecutiveFailures: 0 };
  }
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as HeartbeatState;
  } catch (err) {
    console.warn("[cloud] Failed to read heartbeat state:", err);
    return { version: 1, consecutiveFailures: 0 };
  }
}

/** Write heartbeat state atomically. */
function writeHeartbeatState(deployDir: string, state: HeartbeatState): void {
  const path = heartbeatPath(deployDir);
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const content = JSON.stringify(state, null, 2) + "\n";
  const tmpName = `.heartbeat.tmp.${randomBytes(6).toString("hex")}`;
  const tmpPath = join(dir, tmpName);

  try {
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, path);
  } catch (err) {
    console.warn("[cloud] Failed to write heartbeat state:", err);
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
  } catch (err) {
    console.warn(`[heartbeat] dirSizeBytes failed for ${dirPath}:`, err);
  }
  return total;
}

/**
 * Count integrations from credentials.json without reading credential values.
 */
function countIntegrations(deployDir: string): number {
  const credPath = join(deployDir, "engine", "credentials.json");
  if (!existsSync(credPath)) return 0;
  try {
    const raw = readFileSync(credPath, "utf-8");
    const store = JSON.parse(raw) as { credentials?: readonly unknown[] };
    return store.credentials?.length ?? 0;
  } catch (err) {
    console.warn(`[heartbeat] countIntegrations failed for ${credPath}:`, err);
    return 0;
  }
}

/**
 * Check if the container is running by looking for the compose file
 * and checking docker state via the filesystem.
 */
function checkContainerRunning(deployDir: string): { running: boolean; uptimeSeconds: number } {
  // Check if compose file exists as a basic proxy
  const composePath = join(deployDir, "engine", "docker-compose.yml");
  if (!existsSync(composePath)) {
    return { running: false, uptimeSeconds: -1 };
  }
  // Container state would normally be checked via Docker API;
  // for now we check if the engine directory looks active
  const configPath = join(deployDir, "engine", "openclaw.json");
  if (!existsSync(configPath)) {
    return { running: false, uptimeSeconds: -1 };
  }
  // Report as running if config exists (actual docker check is in operate module)
  return { running: true, uptimeSeconds: 0 };
}

/**
 * Get disk usage percentage for the deploy directory.
 */
function getDiskUsagePercent(_deployDir: string): number {
  // Would use statvfs in production; return 0 as placeholder
  return 0;
}

/**
 * Collect a health report. Never includes content — only operational metadata.
 */
export function collectHealthReport(
  deployDir: string,
  trustMode: TrustMode,
): HealthReport {
  const container = checkContainerRunning(deployDir);
  const memoryDir = join(deployDir, "workspace", "memory");

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
  const report = collectHealthReport(deployDir, trustMode);

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

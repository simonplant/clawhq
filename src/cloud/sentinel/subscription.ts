/**
 * Sentinel subscription state management.
 *
 * Manages the local subscription state (connect/disconnect/status) and
 * communicates with the Sentinel API for registration and checks.
 *
 * State is persisted at ~/.clawhq/cloud/sentinel.json using the same
 * atomic write pattern as heartbeat and command queue.
 */

import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import {
  DIR_MODE_SECRET,
  FILE_MODE_SECRET,
  SENTINEL_API_BASE,
  SENTINEL_API_TIMEOUT_MS,
  SENTINEL_PRICING_URL,
} from "../../config/defaults.js";
import { DEPLOY_CLOUD_SUBDIR } from "../../config/paths.js";
import { breakageToAlerts, predictBreakage } from "./analyzer.js";
import { generateFingerprint } from "./fingerprint.js";
import { analyzeUpstreamCommits, fetchUpstreamCommits } from "./monitor.js";
import type {
  SentinelAlert,
  SentinelCheckResult,
  SentinelConnectResult,
  SentinelSubscription,
} from "./types.js";

// ── Constants ──────────────────────────────────────────────────────────────

const SENTINEL_FILE = "sentinel.json";

// ── Path Helpers ───────────────────────────────────────────────────────────

/** Resolve sentinel.json path for a deployment directory. */
export function sentinelPath(deployDir: string): string {
  return join(deployDir, DEPLOY_CLOUD_SUBDIR, SENTINEL_FILE);
}

/** Get the Sentinel pricing page URL. */
export function getPricingUrl(): string {
  return SENTINEL_PRICING_URL;
}

// ── State Management ───────────────────────────────────────────────────────

/** Read Sentinel subscription state from disk. Returns default if not found. */
export function readSentinelState(deployDir: string): SentinelSubscription {
  const path = sentinelPath(deployDir);
  if (!existsSync(path)) {
    return { version: 1, active: false, tier: "free", consecutiveFailures: 0 };
  }
  let parsed: Record<string, unknown>;
  try {
    const raw = readFileSync(path, "utf-8");
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { version: 1, active: false, tier: "free", consecutiveFailures: 0 };
  }
  if (parsed.version !== 1) {
    throw new Error(
      `Unsupported sentinel state version ${String(parsed.version)} (expected 1). ` +
      `The state file at ${path} may have been created by a newer version of ClawHQ.`,
    );
  }
  return parsed as unknown as SentinelSubscription;
}

/** Write Sentinel subscription state atomically. */
export function writeSentinelState(deployDir: string, state: SentinelSubscription): void {
  const path = sentinelPath(deployDir);
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: DIR_MODE_SECRET });
  }
  chmodSync(dir, DIR_MODE_SECRET);

  const content = JSON.stringify(state, null, 2) + "\n";
  const tmpName = `.sentinel.tmp.${randomBytes(6).toString("hex")}`;
  const tmpPath = join(dir, tmpName);

  try {
    writeFileSync(tmpPath, content, { mode: FILE_MODE_SECRET });
    chmodSync(tmpPath, FILE_MODE_SECRET);
    renameSync(tmpPath, path);
  } catch {
    // Write failed — sentinel state is best-effort
  }
}

// ── Subscription Operations ────────────────────────────────────────────────

/**
 * Connect to Sentinel monitoring service.
 *
 * Registers the deployment with the Sentinel API and activates
 * upstream monitoring. Sends the initial config fingerprint.
 */
export async function connectSentinel(
  deployDir: string,
  options?: {
    readonly token?: string;
    readonly webhookUrl?: string;
    readonly alertEmail?: string;
    readonly signal?: AbortSignal;
  },
): Promise<SentinelConnectResult> {
  const fingerprint = generateFingerprint(deployDir);
  const now = new Date().toISOString();

  // If a token is provided, validate it with the Sentinel API
  if (options?.token) {
    try {
      const response = await fetch(`${SENTINEL_API_BASE}/subscribe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${options.token}`,
          "User-Agent": "ClawHQ-Sentinel/1.0",
        },
        body: JSON.stringify({
          fingerprint,
          webhookUrl: options.webhookUrl,
          alertEmail: options.alertEmail,
        }),
        signal: options.signal ?? AbortSignal.timeout(SENTINEL_API_TIMEOUT_MS),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        return {
          success: false,
          tier: "free",
          error: `Sentinel API error: HTTP ${response.status} — ${errorText}`,
        };
      }

      const data = (await response.json()) as { tier?: string };
      const tier = data.tier === "pro" ? "pro" as const : "free" as const;

      writeSentinelState(deployDir, {
        version: 1,
        active: true,
        tier,
        token: options.token,
        webhookUrl: options.webhookUrl,
        alertEmail: options.alertEmail,
        activatedAt: now,
        lastCheckAt: now,
        consecutiveFailures: 0,
        lastFingerprint: fingerprint,
      });

      return { success: true, tier };
    } catch (err) {
      return {
        success: false,
        tier: "free",
        error: `Failed to connect: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // No token — activate in free tier (local monitoring only)
  writeSentinelState(deployDir, {
    version: 1,
    active: true,
    tier: "free",
    webhookUrl: options?.webhookUrl,
    alertEmail: options?.alertEmail,
    activatedAt: now,
    consecutiveFailures: 0,
    lastFingerprint: fingerprint,
  });

  return { success: true, tier: "free" };
}

/**
 * Disconnect from Sentinel monitoring.
 */
export function disconnectSentinel(deployDir: string): { success: boolean; wasActive: boolean } {
  const current = readSentinelState(deployDir);
  const wasActive = current.active;

  writeSentinelState(deployDir, {
    version: 1,
    active: false,
    tier: current.tier,
    consecutiveFailures: 0,
  });

  return { success: true, wasActive };
}

/**
 * Run a Sentinel check — fetch upstream commits, analyze for breakage,
 * and return alerts.
 *
 * This is the main user-facing operation. It:
 * 1. Generates a fresh config fingerprint
 * 2. Fetches recent upstream commits from GitHub
 * 3. Analyzes them for config-impacting changes
 * 4. Predicts breakage against the user's config
 * 5. Returns alerts for any predicted breakage
 */
export async function runSentinelCheck(
  deployDir: string,
  signal?: AbortSignal,
): Promise<SentinelCheckResult> {
  const state = readSentinelState(deployDir);
  const now = new Date().toISOString();

  try {
    // Step 1: Generate fresh fingerprint
    const fingerprint = generateFingerprint(deployDir);

    // Step 2: Fetch upstream commits since last check
    const commits = await fetchUpstreamCommits({
      since: state.lastCheckAt,
      signal,
    });

    if (commits.length === 0) {
      writeSentinelState(deployDir, {
        ...state,
        lastCheckAt: now,
        consecutiveFailures: 0,
        lastFingerprint: fingerprint,
      });
      return {
        success: true,
        alerts: [],
        timestamp: now,
      };
    }

    // Step 3: Analyze upstream commits
    const analysis = analyzeUpstreamCommits(commits);

    // Step 4: Predict breakage
    const report = predictBreakage(analysis, fingerprint);

    // Step 5: Generate alerts
    const alerts: SentinelAlert[] = [...breakageToAlerts(report)];

    // Update state
    writeSentinelState(deployDir, {
      ...state,
      lastCheckAt: now,
      consecutiveFailures: 0,
      lastFingerprint: fingerprint,
    });

    return {
      success: true,
      alerts,
      breakageReport: report,
      timestamp: now,
    };
  } catch (err) {
    const error = `Sentinel check failed: ${err instanceof Error ? err.message : String(err)}`;

    writeSentinelState(deployDir, {
      ...state,
      consecutiveFailures: state.consecutiveFailures + 1,
      lastError: error,
    });

    return {
      success: false,
      alerts: [],
      error,
      timestamp: now,
    };
  }
}

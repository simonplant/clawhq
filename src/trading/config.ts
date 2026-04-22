/**
 * Runtime config for the Clawdius trading assistant.
 *
 * Environment-driven with sensible defaults. All paths resolve against
 * TRADING_DEPLOY_DIR (falls back to ClawHQ's default ~/.clawhq).
 */

import { homedir } from "node:os";
import { join } from "node:path";

import type { Account, Horizon } from "./types.js";

// ── Paths ────────────────────────────────────────────────────────────────────

export interface TradingPaths {
  deployDir: string;
  /** Shared volume with OpenClaw and other sidecars. */
  sharedDir: string;
  /** Workspace memory (today's brief lives here). */
  memoryDir: string;
  /** SQLite events DB. */
  dbPath: string;
}

export function resolvePaths(): TradingPaths {
  const deployDir = process.env.TRADING_DEPLOY_DIR ?? join(homedir(), ".clawhq");
  return {
    deployDir,
    sharedDir: join(deployDir, "shared"),
    memoryDir: join(deployDir, "workspace", "memory"),
    dbPath: join(deployDir, "shared", "trading.db"),
  };
}

/** Today's brief filename: `trading-YYYY-MM-DD.md`. */
export function briefPathFor(paths: TradingPaths, date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return join(paths.memoryDir, `trading-${y}-${m}-${d}.md`);
}

// ── Watchlist ────────────────────────────────────────────────────────────────

/**
 * Comma-separated TRADING_WATCHLIST env, or a conservative default.
 * Merged at runtime with symbols referenced by today's ORDER blocks.
 */
export function resolveWatchlist(): string[] {
  const raw = process.env.TRADING_WATCHLIST;
  if (raw) return raw.split(",").map((s) => s.trim()).filter(Boolean);
  return [
    "SPY",
    "QQQ",
    "IWM",
    "AAPL",
    "MSFT",
    "NVDA",
    "META",
    "GOOGL",
    "AMZN",
    "TSLA",
  ];
}

// ── Tradier ──────────────────────────────────────────────────────────────────

export interface TradierConfig {
  /** Base URL — routed through cred-proxy on the bridge network by default. */
  baseUrl: string;
  /** Account ID for positions + P&L. */
  accountId: string;
  /** Sandbox vs production. */
  sandbox: boolean;
}

export function resolveTradier(): TradierConfig {
  return {
    baseUrl: process.env.TRADIER_BASE_URL ?? "http://cred-proxy:9876/tradier",
    accountId: process.env.TRADIER_ACCOUNT_ID ?? "",
    sandbox: process.env.TRADIER_SANDBOX === "1",
  };
}

// ── Signal ───────────────────────────────────────────────────────────────────

export interface SignalConfig {
  /** Path to signal-cli binary (defaults to PATH lookup). */
  binary: string;
  /** Simon's own Signal number. */
  selfNumber: string;
  /** Recipient number (defaults to self — note-to-self pattern). */
  recipientNumber: string;
  /** Polling interval for incoming messages (ms). */
  receivePollMs: number;
}

export function resolveSignal(): SignalConfig {
  const self = process.env.SIGNAL_SELF_NUMBER ?? "";
  return {
    binary: process.env.SIGNAL_CLI_BINARY ?? "signal-cli",
    selfNumber: self,
    recipientNumber: process.env.SIGNAL_RECIPIENT_NUMBER ?? self,
    receivePollMs: Number(process.env.SIGNAL_RECEIVE_POLL_MS ?? 3000),
  };
}

// ── Risk thresholds ──────────────────────────────────────────────────────────

export interface RiskThresholds {
  /** Max per-trade risk as fraction of account balance. */
  maxRiskPerTradeFraction: number;
  /** Max concurrent positions (applies to Tradier strict). */
  maxConcurrentPositions: number;
  /** Max total exposure fraction. */
  maxExposureFraction: number;
  /** Tradier PDT day-trade count over rolling 5 days. */
  pdtLimit: number;
  /** Daily loss halt threshold in dollars (negative — e.g. -300). */
  dailyLossLimitUsd: number;
}

export interface AccountConfig {
  balance: number;
  /** Whether positions are programmatically queryable. Only tradier=true. */
  apiVisible: boolean;
}

export function resolveAccounts(): Record<Account, AccountConfig> {
  return {
    tos: {
      balance: Number(process.env.ACCOUNT_TOS_BALANCE ?? 100_000),
      apiVisible: false,
    },
    ira: {
      balance: Number(process.env.ACCOUNT_IRA_BALANCE ?? 100_000),
      apiVisible: false,
    },
    tradier: {
      balance: Number(process.env.ACCOUNT_TRADIER_BALANCE ?? 3_000),
      apiVisible: true,
    },
  };
}

export function defaultRiskThresholds(): RiskThresholds {
  return {
    maxRiskPerTradeFraction: 0.01,
    maxConcurrentPositions: 4,
    maxExposureFraction: 0.6,
    pdtLimit: 3,
    dailyLossLimitUsd: Number(process.env.DAILY_LOSS_LIMIT_USD ?? -300),
  };
}

// ── Timing constants ─────────────────────────────────────────────────────────

/** Poll loop cadence. */
export const POLL_MS = 1000;

/** Market-clock re-check cadence. */
export const CLOCK_CHECK_MS = 60 * 1000;

/** Heartbeat cadence (during market hours). */
export const HEARTBEAT_MS = 15 * 60 * 1000;

/** Signal self-ping cadence. */
export const SELF_PING_MS = 60 * 60 * 1000;

/** N consecutive poll failures before alerting Simon. */
export const POLL_FAILURE_ALERT_THRESHOLD = 30;

/** Per-horizon alert TTL (ms). */
export const ALERT_TTL_MS: Record<Horizon, number> = {
  session: 5 * 60 * 1000,
  swing: 30 * 60 * 1000,
  portfolio: 24 * 60 * 60 * 1000,
};

/** Catch-up alerts from boot reconciler expire quickly (likely stale). */
export const CATCHUP_TTL_MS = 15 * 60 * 1000;

/** Quote staleness threshold — skip detection if last tick older than this. */
export const QUOTE_STALE_MS = 10 * 1000;

// ── Proximity thresholds (fractions of entry price) ──────────────────────────

export const PROXIMITY_AT = 0.0015;
export const PROXIMITY_NEAR = 0.005;
export const PROXIMITY_APPROACHING = 0.015;
export const PROXIMITY_STOP_TARGET = 0.003;

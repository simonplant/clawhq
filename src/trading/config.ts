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

// ── Telegram ─────────────────────────────────────────────────────────────────

export interface TelegramConfig {
  /** Bot token (shared with OpenClaw's Telegram channel). */
  botToken: string;
  /** Simon's Telegram chat id. */
  chatId: string;
  /** Per-request timeout against the Telegram API (ms). */
  timeoutMs: number;
}

/**
 * Outbound-only Telegram config. OpenClaw owns inbound polling on the same
 * bot token; we never call getUpdates. Chat id defaults to Simon's from
 * workspace/USER.md — override via TELEGRAM_CHAT_ID in .env if needed.
 */
/**
 * Path to the rolling track-record JSONL. When set, the orchestrator reads
 * it on plan reload and derives per-source quality multipliers that feed
 * confluence scoring. Absent = feature off (neutral 1.0 for every source).
 */
export function resolveTrackRecordPath(): string | undefined {
  const raw = process.env.TRACK_RECORD_JSONL_PATH;
  return raw && raw.trim() ? raw.trim() : undefined;
}

export function resolveTelegram(): TelegramConfig {
  return {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
    chatId: process.env.TELEGRAM_CHAT_ID ?? "",
    timeoutMs: Number(process.env.TELEGRAM_TIMEOUT_MS ?? 5000),
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
  /**
   * True when the broker prohibits short sales in this account (IRAs).
   * Unlike other advisory rules, this is a structural impossibility, not a
   * governor overreach — a SHORT order routed to a long-only account is
   * intrinsically invalid and the governor blocks it.
   */
  longOnly: boolean;
}

export function resolveAccounts(): Record<Account, AccountConfig> {
  return {
    tos: {
      balance: Number(process.env.ACCOUNT_TOS_BALANCE ?? 100_000),
      apiVisible: false,
      longOnly: false,
    },
    ira: {
      balance: Number(process.env.ACCOUNT_IRA_BALANCE ?? 100_000),
      apiVisible: false,
      longOnly: true,
    },
    tradier: {
      balance: Number(process.env.ACCOUNT_TRADIER_BALANCE ?? 3_000),
      apiVisible: true,
      longOnly: false,
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

// ── Contract multipliers ─────────────────────────────────────────────────────

/**
 * Dollar value of one contract price-point by execution symbol.
 *
 * Stocks trade as 1 share × price. Futures trade as `multiplier × price` —
 * /MES at 7090 is $5×7090 = $35,450 of notional per contract, not $7,090.
 * Ignoring the multiplier under-counts notional and makes the exposure cap
 * useless for futures orders. Equity options are $100/contract.
 *
 * Add new symbols as they start appearing in the extractor outputs.
 * Unknown symbols default to 1 (treated as shares) — this mirrors the
 * pre-existing behavior so legacy fixtures stay green.
 */
const CONTRACT_MULTIPLIERS: Record<string, number> = {
  // CME equity-index futures.
  "/ES": 50,
  "/MES": 5,
  "/NQ": 20,
  "/MNQ": 2,
  "/RTY": 50,
  "/M2K": 5,
  "/YM": 5,
  "/MYM": 0.5,
  // CME crude + metals.
  "/CL": 1000,
  "/MCL": 100,
  "/GC": 100,
  "/MGC": 10,
  "/SI": 5000,
  "/SIL": 1000,
};

export function contractMultiplier(execAs: string): number {
  const sym = execAs.trim().toUpperCase();
  if (sym in CONTRACT_MULTIPLIERS) return CONTRACT_MULTIPLIERS[sym]!;
  if (sym.startsWith("/")) {
    // Unknown future — conservative fallback. Log path is the caller's job.
    return 1;
  }
  // Equity option chains come through as e.g. "AAPL  240621C00200000".
  // Two consecutive spaces is the OSI-ish marker. 100 shares per contract.
  if (/\s{2,}/.test(execAs)) return 100;
  return 1;
}

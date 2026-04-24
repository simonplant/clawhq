/**
 * Type definitions for the Clawdius trading assistant.
 *
 * Aligned with configs/references/STANDARD_ORDER_FORMAT.md — the authoritative
 * schema for ORDER blocks. These types are hand-authored against that spec and
 * gated by golden-file parser tests. Changing the schema requires updating the
 * reference doc, these types, and the golden fixtures together.
 */

// ── Enums ────────────────────────────────────────────────────────────────────

export const CONVICTIONS = ["HIGH", "MEDIUM", "LOW", "EXCLUDE"] as const;
export type Conviction = (typeof CONVICTIONS)[number];

export const CONFIRMATIONS = ["PENDING_TA", "CONFIRMED", "MANUAL"] as const;
export type Confirmation = (typeof CONFIRMATIONS)[number];

export const ORDER_STATUSES = [
  "ACTIVE",
  "CONDITIONAL",
  "TRIGGERED",
  "FILLED",
  "CLOSED",
  "KILLED",
  "BLOCKED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type Direction = "LONG" | "SHORT";
export type Source = "mancini" | "dp" | "focus25" | "scanner";
export type Account = "tos" | "ira" | "tradier";
export type Horizon = "portfolio" | "swing" | "session";
export type ProximityClass = "AT" | "NEAR" | "APPROACHING" | "STOP" | "TARGET";
export type LevelName = "entry" | "stop" | "t1" | "t2";

// ── ORDER block (from STANDARD_ORDER_FORMAT.md) ─────────────────────────────

/**
 * A single trade idea from an extractor (mancini / dp / focus25 / scanner).
 * One ORDER block is self-contained — everything needed to monitor and execute.
 */
export interface OrderBlock {
  /** Stable identifier synthesized as source-ticker-entry hash for dedup. */
  id: string;
  /** 1-indexed order number within today's plan. */
  sequence: number;
  source: Source;
  /** Eligible accounts. Routing decision, not sizing. */
  accounts: Account[];
  /** Human-facing ticker (ES, META). */
  ticker: string;
  /** Execution symbol (/MES for futures, ticker for stocks). */
  execAs: string;
  direction: Direction;
  /** Setup type + quality words (≤20 words). */
  setup: string;
  /** One-line actionability reason (≤15 words). */
  why: string;

  entry: number;
  entryOrderType: "LMT" | "MKT";
  stop: number;
  /** How the stop was derived (e.g. "stated", "MA-2%"). */
  stopSource: string;
  t1: number;
  t1Source: string;
  t2: number;
  t2Source: string;
  /** Runner rule (typically "10% trail BE after T1"). */
  runner: string;

  riskPerShare: number;
  quantity: number;
  /** Total dollar risk = riskPerShare × quantity. */
  totalRisk: number;

  confirmation: Confirmation;
  conviction: Conviction;
  /** "none", "DP+MANCINI", "DP+FOCUS25", or "divergence: ...". */
  confluence: string;
  /** Verbatim warning from source, or "none". */
  caveat: string;
  /** Conditions that invalidate (e.g. ["dp_flat", "gap_killed"]). */
  kills: string[];
  /** "immediate" or conditional activation text. */
  activation: string;
  /** What needs human checking, or "none". */
  verify: string;

  status: OrderStatus;
}

// ── Market data ──────────────────────────────────────────────────────────────

export interface PriceQuote {
  symbol: string;
  last: number;
  bid: number;
  ask: number;
  /** Quote timestamp from Tradier (ms since epoch). */
  tsMs: number;
  /** Our wall-clock receive time (ms since epoch). */
  receivedMs: number;
}

export interface MarketClock {
  state: "open" | "closed" | "premarket" | "postmarket";
  /** Next state-change time (ms since epoch). */
  nextChangeMs: number;
  /** Human-readable description from Tradier. */
  description: string;
}

// ── Detection output ─────────────────────────────────────────────────────────

export interface LevelHit {
  orderId: string;
  sequence: number;
  ticker: string;
  source: Source;
  levelName: LevelName;
  levelPrice: number;
  crossingDirection: "UP" | "DOWN";
  proximity: ProximityClass;
  conviction: Conviction;
  confirmation: Confirmation;
  prevPrice: number;
  currentPrice: number;
  hitMs: number;
  /** Catch-up hit from boot reconciliation; TTL is shorter. */
  catchup?: boolean;
}

// ── Risk ─────────────────────────────────────────────────────────────────────

export interface RiskState {
  tradierBalance: number;
  tradierPositions: Array<{ symbol: string; qty: number; avgPrice: number }>;
  tradierDailyPnl: number;
  tradierPdtCountLast5Days: number;
  /** Advisory holdings parsed from today.md — no API visibility for TOS/IRA. */
  advisoryHoldings: Array<{ ticker: string; accounts: Account[]; notes?: string }>;
  /**
   * Currently-active event blackouts. Populated by the orchestrator from
   * the earnings / market-calendar tools. The governor consumes but does
   * not compute — keeps risk.ts a pure function of explicit state.
   *
   * scope "all"   : applies to every order (FOMC, CPI, NFP, market halt).
   * scope {ticker}: applies only to orders whose ticker matches (earnings,
   *                  company-specific halts, SEC filings).
   */
  activeBlackouts?: Array<{
    scope: "all" | { ticker: string };
    /** Short label — e.g. "FOMC", "CPI", "NVDA earnings". */
    name: string;
    /** One-line human reason suitable for alert annotation. */
    reason: string;
  }>;
}

export interface RiskDecision {
  /** If set, alert is suppressed — used for Tradier-strict blocks only. */
  block?: string;
  /** If set, alert is annotated with this warning. */
  warn?: string;
  /**
   * scope:
   *   tradier-strict — order is Tradier-only; governor is authoritative
   *   advisory-only  — order targets TOS/IRA; governor annotates only
   *   mixed          — multi-account order; strict for Tradier, advisory elsewhere
   */
  scope: "tradier-strict" | "advisory-only" | "mixed";
}

// ── Confluence (derived in confluence.ts; carried on Alert for logging) ──────

export type ConfluenceTier = "none" | "aligned" | "strong-aligned" | "divergent";

export interface ConfluenceSnapshot {
  tier: ConfluenceTier;
  /** 0–100. 50 is single-source baseline. */
  score: number;
  /** Human-readable one-liner suitable for alert annotation. */
  label: string;
}

// ── Alert protocol ───────────────────────────────────────────────────────────

export interface Alert {
  /** Unique 4-char suffix (e.g. "A7F3"). */
  id: string;
  orderId: string;
  sequence: number;
  source: Source;
  horizon: Horizon;
  ticker: string;
  execAs: string;
  accounts: Account[];
  direction: Direction;
  conviction: Conviction;
  confirmation: Confirmation;
  entry: number;
  stop: number;
  t1: number;
  t2: number;
  totalRisk: number;
  levelName: LevelName;
  levelPrice: number;
  risk: RiskDecision;
  /** Wall-clock expiry (ms since epoch). */
  expiresAtMs: number;
  /** True when reconciler emitted this as a catch-up. */
  catchup?: boolean;
  /** Optional — present when caller computed confluence for the plan. */
  confluence?: ConfluenceSnapshot;
}

export type UserReplyType =
  | "approve"
  | "reduce-half"
  | "reduce-third"
  | "reject"
  | "defer-5m"
  | "defer-to-open";

// ── Events table tagged union ────────────────────────────────────────────────

/**
 * Every event that can land in the SQLite events table. Adding a new type:
 * extend this union, no migrations required — payload_json is versionless.
 */
export type TradingEvent =
  | { type: "Poll"; tsMs: number; quotes: PriceQuote[] }
  | { type: "PollFailed"; tsMs: number; error: string; consecutiveFailures: number }
  | { type: "PlanLoaded"; tsMs: number; orderCount: number; path: string }
  | { type: "PlanParseFailed"; tsMs: number; error: string; path: string }
  | { type: "PlanMissing"; tsMs: number; path: string }
  | { type: "LevelHit"; tsMs: number; hit: LevelHit }
  | { type: "AlertSent"; tsMs: number; alert: Alert }
  | {
      type: "AlertExpired";
      tsMs: number;
      alertId: string;
      reason: "TTL" | "NO_CHANNEL";
    }
  | {
      type: "UserReply";
      tsMs: number;
      alertId: string;
      reply: UserReplyType;
      raw: string;
    }
  | {
      type: "UserReplyIgnored";
      tsMs: number;
      alertId: string;
      reason: "duplicate" | "ambiguous" | "expired" | "unknown-id";
      raw: string;
    }
  | {
      type: "RiskDecision";
      tsMs: number;
      orderId: string;
      decision: RiskDecision;
    }
  | {
      type: "HaltEdge";
      tsMs: number;
      haltType: "MANUAL" | "DAILY_LOSS" | "MARKET" | "SYMBOL";
      direction: "entered" | "cleared";
      reason?: string;
      symbol?: string;
    }
  | {
      type: "Heartbeat";
      tsMs: number;
      symbolCount: number;
      alertsToday: number;
      pnlTradier: number;
      nextAtMs: number;
    }
  | { type: "SignalSelfPingSent"; tsMs: number; pingId: string }
  | {
      type: "SignalSelfPingReceived";
      tsMs: number;
      pingId: string;
      latencyMs: number;
    }
  | {
      type: "SignalHealthFailed";
      tsMs: number;
      consecutiveFailures: number;
    }
  | {
      type: "CommandReceived";
      tsMs: number;
      command: string;
      rawArgs: string;
    }
  | { type: "ServiceReady"; tsMs: number }
  | { type: "ServiceShuttingDown"; tsMs: number; reason: string }
  | {
      type: "MarketClockChecked";
      tsMs: number;
      state: MarketClock["state"];
      nextChangeMs: number;
    };

/** As persisted in SQLite — row id plus decoded payload. */
export interface EventRow {
  id: number;
  tsMs: number;
  type: TradingEvent["type"];
  payload: TradingEvent;
}

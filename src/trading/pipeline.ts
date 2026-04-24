/**
 * Alert pipeline composition — pure functions that turn a LevelHit into
 * an Alert, given the relevant order and risk decision.
 *
 * Extracted from index.ts so the core logic is testable without standing
 * up the full runtime (timers, Hono server, Tradier client, fs watcher).
 * The orchestration in index.ts calls these for every hit.
 */

import { ALERT_TTL_MS, CATCHUP_TTL_MS } from "./config.js";
import type {
  Account,
  Alert,
  ConfluenceSnapshot,
  Horizon,
  LevelHit,
  NotifyTier,
  OrderBlock,
  RiskDecision,
} from "./types.js";

export interface BuildAlertInputs {
  hit: LevelHit;
  order: OrderBlock;
  decision: RiskDecision;
  nowMs: number;
  alertId: string;
  /** Mark this alert as a boot-time catch-up; uses a shorter TTL. */
  catchup?: boolean;
  /** Optional cross-source alignment snapshot for this order. */
  confluence?: ConfluenceSnapshot;
}

/**
 * Compose an Alert from a fired LevelHit, the matching OrderBlock, and
 * the governor's decision for it. Caller has already decided the hit is
 * worth alerting (no halt active, decision not blocked, etc.).
 */
export function buildAlert(inputs: BuildAlertInputs): Alert {
  const { hit, order, decision, nowMs, alertId } = inputs;
  const horizon = horizonForOrder(order);
  const ttl = inputs.catchup ? CATCHUP_TTL_MS : ALERT_TTL_MS[horizon];
  return {
    id: alertId,
    orderId: order.id,
    sequence: order.sequence,
    source: order.source,
    horizon,
    ticker: order.ticker,
    execAs: order.execAs,
    accounts: order.accounts,
    direction: order.direction,
    conviction: order.conviction,
    confirmation: order.confirmation,
    entry: order.entry,
    stop: order.stop,
    t1: order.t1,
    t2: order.t2,
    totalRisk: order.totalRisk,
    levelName: hit.levelName,
    levelPrice: hit.levelPrice,
    risk: decision,
    expiresAtMs: nowMs + ttl,
    notify: classifyNotify({
      levelName: hit.levelName,
      conviction: order.conviction,
      decision,
      confluence: inputs.confluence,
    }),
    ...(inputs.catchup ? { catchup: true } : {}),
    ...(inputs.confluence ? { confluence: inputs.confluence } : {}),
    ...(hit.postT1Runner ? { postT1Runner: true } : {}),
  };
}

/**
 * Choose the notification tier for an alert.
 *
 * LOUD when at least one of:
 *   - stop or target hit (price action, not pending entry)
 *   - HIGH conviction entry
 *   - governor warn or block (Simon needs to see it)
 *   - confluence divergent (cross-source disagreement)
 *   - confluence strong-aligned (best setups of the day)
 *
 * QUIET otherwise — single-source MEDIUM/LOW entry ticks through chop.
 * These still fire, still log, still appear in Telegram; just without
 * the notification ping. Trims fatigue without losing information.
 */
export function classifyNotify(inputs: {
  levelName: LevelHit["levelName"];
  conviction: OrderBlock["conviction"];
  decision: RiskDecision;
  confluence?: ConfluenceSnapshot;
}): NotifyTier {
  const { levelName, conviction, decision, confluence } = inputs;
  if (levelName !== "entry") return "loud";
  if (conviction === "HIGH") return "loud";
  if (decision.block || decision.warn) return "loud";
  if (confluence?.tier === "divergent" || confluence?.tier === "strong-aligned") {
    return "loud";
  }
  return "quiet";
}

/**
 * Map a source to its horizon. Phase A heuristic:
 *   - mancini  → session  (intraday /ES on 15-min rhythm)
 *   - dp, focus25, scanner → swing (multi-day; DP VTF shifts are manual)
 *
 * Refine if/when track-record data warrants per-source horizon rules.
 */
export function horizonForOrder(order: OrderBlock): Horizon {
  if (order.source === "mancini") return "session";
  return "swing";
}

/** Scope classifier used for risk decisions and alert annotations. */
export function scopeForAccounts(
  accounts: readonly Account[],
): RiskDecision["scope"] {
  const hasTradier = accounts.includes("tradier");
  const hasAdvisory = accounts.includes("tos") || accounts.includes("ira");
  if (hasTradier && hasAdvisory) return "mixed";
  if (hasTradier) return "tradier-strict";
  return "advisory-only";
}

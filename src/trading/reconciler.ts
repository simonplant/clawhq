/**
 * Boot reconciler — catch-up alerts on startup.
 *
 * The most important safety net in Phase A. Without this, any mid-session
 * crash drops trades silently: the container restarts, plan-monitor has
 * no prior price, and level crossings that happened during the gap are
 * never detected.
 *
 * On startup, for each ORDER block we check whether today's intraday
 * range (dayHigh / dayLow from the current Tradier quote) spans any
 * planned level. If yes AND the events log has no `AlertSent` for
 * (orderId, levelName) today, we emit a catch-up alert flagged so Simon
 * can distinguish it from a live alert.
 */

import type { EventRow, LevelName, OrderBlock, PriceQuote } from "./types.js";

export interface CatchupCandidate {
  order: OrderBlock;
  levelName: LevelName;
  levelPrice: number;
  dayHigh: number;
  dayLow: number;
  currentPrice: number;
}

export interface ReconcilerInputs {
  orders: OrderBlock[];
  /** Bulk quote result at startup; includes dayHigh/dayLow per symbol. */
  quotes: Array<PriceQuote & { dayHigh: number; dayLow: number }>;
  /** AlertSent events for today (from SQLite). */
  todaysAlerts: EventRow[];
}

/**
 * Pure function — given orders, quotes, and today's alerts so far, return
 * the set of (order, level) tuples that need catch-up alerts. Does NOT
 * emit alerts; caller feeds these into the normal alert-sender path with
 * catchup=true.
 */
export function findCatchupCandidates(
  inputs: ReconcilerInputs,
): CatchupCandidate[] {
  const quoteByTicker = new Map<string, typeof inputs.quotes[number]>();
  for (const q of inputs.quotes) {
    quoteByTicker.set(q.symbol.toUpperCase(), q);
  }

  const alertedToday = new Set<string>();
  for (const row of inputs.todaysAlerts) {
    if (row.payload.type !== "AlertSent") continue;
    const { alert } = row.payload;
    alertedToday.add(`${alert.orderId}|${alert.levelName}`);
  }

  const out: CatchupCandidate[] = [];
  for (const order of inputs.orders) {
    if (!isLive(order)) continue;
    const quote = quoteByTicker.get(order.ticker.toUpperCase());
    if (!quote) continue;
    const { dayHigh, dayLow } = quote;
    // Require a real intraday range before considering catch-up candidates.
    // `dayHigh === dayLow` means the session either hasn't traded or only
    // printed a single price — treating that as "the level was touched" is
    // a false positive. Use strict `<=` so a flat day is rejected.
    if (!(dayHigh > 0 && dayLow > 0) || dayHigh <= dayLow) continue;

    for (const [name, price] of levelsFor(order)) {
      if (price === 0) continue;
      const crossedToday = price >= dayLow && price <= dayHigh;
      if (!crossedToday) continue;
      const key = `${order.id}|${name}`;
      if (alertedToday.has(key)) continue;
      out.push({
        order,
        levelName: name,
        levelPrice: price,
        dayHigh,
        dayLow,
        currentPrice: quote.last,
      });
    }
  }
  return out;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function levelsFor(order: OrderBlock): Array<[LevelName, number]> {
  return [
    ["entry", order.entry],
    ["stop", order.stop],
    ["t1", order.t1],
    ["t2", order.t2],
  ];
}

function isLive(order: OrderBlock): boolean {
  return (
    order.status !== "CLOSED" &&
    order.status !== "KILLED" &&
    order.status !== "BLOCKED" &&
    order.status !== "FILLED"
  );
}

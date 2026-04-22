/**
 * Interval-crossing level detector.
 *
 * At 1Hz polling, prices rarely land exactly on a level — we see prev=7019
 * then current=7023 and must treat that as a cross. The detector:
 *
 *   1. Remembers the previous price per symbol (last successful poll).
 *   2. On each new poll, checks each ORDER block targeting that symbol.
 *   3. For each of {entry, stop, t1, t2}, emits a LevelHit when
 *      `prev < level <= current` (UP cross) or `prev > level >= current`
 *      (DOWN cross).
 *   4. Dedupes within a TTL window on (orderId, levelName, direction) to
 *      avoid alert storms on choppy ticks through the level.
 *
 * Stateful by design — caller creates once and feeds quotes. Uses a
 * monotonic clock for dedup TTL; wall-clock only for event timestamps.
 */

import { performance } from "node:perf_hooks";

import {
  PROXIMITY_AT,
  PROXIMITY_APPROACHING,
  PROXIMITY_NEAR,
  PROXIMITY_STOP_TARGET,
} from "./config.js";
import type {
  LevelHit,
  LevelName,
  OrderBlock,
  PriceQuote,
  ProximityClass,
} from "./types.js";

/** How long (ms) a (orderId, levelName, direction) tuple stays suppressed. */
const DEFAULT_DEDUP_TTL_MS = 60_000;

export interface LevelDetector {
  /** Consume one poll's quotes + the current plan; return any LevelHits. */
  ingest(quotes: PriceQuote[], orders: OrderBlock[], nowMs?: number): LevelHit[];
  /** Last price recorded for a symbol, or undefined. */
  lastPrice(symbol: string): number | undefined;
  /**
   * Seed the detector from a known prior price (e.g. the boot reconciler's
   * catch-up pass uses today's H or L as prev). Useful in tests too.
   */
  seedPrice(symbol: string, price: number): void;
  /** For testing: advance dedup state. */
  clearDedup(): void;
}

export interface DetectorOptions {
  dedupTtlMs?: number;
  /** Injection point for tests. Must return a monotonic ms-scale number. */
  monotonicNowMs?: () => number;
}

export function makeLevelDetector(opts: DetectorOptions = {}): LevelDetector {
  const ttl = opts.dedupTtlMs ?? DEFAULT_DEDUP_TTL_MS;
  const now = opts.monotonicNowMs ?? (() => performance.now());

  /** Last price per uppercased symbol. */
  const lastPriceBySymbol = new Map<string, number>();
  /** Dedup: key = `${orderId}|${levelName}|${direction}`, value = monotonic ms. */
  const lastHitAt = new Map<string, number>();

  function dedupKey(orderId: string, levelName: LevelName, direction: "UP" | "DOWN"): string {
    return `${orderId}|${levelName}|${direction}`;
  }

  function shouldEmit(key: string, monoMs: number): boolean {
    const last = lastHitAt.get(key);
    if (last === undefined) return true;
    if (monoMs - last >= ttl) return true;
    return false;
  }

  return {
    ingest(quotes, orders, nowMs = Date.now()): LevelHit[] {
      const hits: LevelHit[] = [];
      const monoMs = now();

      // Group orders by ticker for O(quote × ordersForTicker) rather than
      // O(quote × all-orders). Also covers ES/MES case where exec_as differs.
      const ordersByTicker = groupBy(orders, (o) => o.ticker.toUpperCase());

      for (const q of quotes) {
        const symbol = q.symbol.toUpperCase();
        const prev = lastPriceBySymbol.get(symbol);
        lastPriceBySymbol.set(symbol, q.last);
        if (prev === undefined) {
          // First poll for this symbol — no crossing possible.
          continue;
        }
        if (prev === q.last) continue;

        const matching = ordersByTicker.get(symbol) ?? [];
        for (const order of matching) {
          if (!isLive(order)) continue;
          for (const [levelName, levelPrice] of levelsFor(order)) {
            const crossing = classifyCrossing(prev, q.last, levelPrice);
            if (!crossing) continue;

            const key = dedupKey(order.id, levelName, crossing);
            if (!shouldEmit(key, monoMs)) continue;
            lastHitAt.set(key, monoMs);

            hits.push({
              orderId: order.id,
              sequence: order.sequence,
              ticker: order.ticker,
              source: order.source,
              levelName,
              levelPrice,
              crossingDirection: crossing,
              proximity: proximityForCross(levelName),
              conviction: order.conviction,
              confirmation: order.confirmation,
              prevPrice: prev,
              currentPrice: q.last,
              hitMs: nowMs,
            });
          }
        }
      }

      return hits;
    },

    lastPrice(symbol): number | undefined {
      return lastPriceBySymbol.get(symbol.toUpperCase());
    },

    seedPrice(symbol, price): void {
      lastPriceBySymbol.set(symbol.toUpperCase(), price);
    },

    clearDedup(): void {
      lastHitAt.clear();
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns crossing direction if `prev → curr` passes through `level`. */
export function classifyCrossing(
  prev: number,
  curr: number,
  level: number,
): "UP" | "DOWN" | null {
  if (prev < level && curr >= level) return "UP";
  if (prev > level && curr <= level) return "DOWN";
  return null;
}

/** Distance to level as a fraction of the level. */
export function distanceFraction(price: number, level: number): number {
  if (level === 0) return Infinity;
  return Math.abs(price - level) / Math.abs(level);
}

/**
 * Proximity class given live distance, level type, and (optionally) direction.
 * Stops and targets are evaluated on a tighter scale than entries.
 */
export function proximityFor(
  levelName: LevelName,
  price: number,
  level: number,
): ProximityClass {
  const d = distanceFraction(price, level);
  if (levelName === "stop") {
    return d <= PROXIMITY_STOP_TARGET ? "STOP" : "APPROACHING";
  }
  if (levelName === "t1" || levelName === "t2") {
    return d <= PROXIMITY_STOP_TARGET ? "TARGET" : "APPROACHING";
  }
  if (d <= PROXIMITY_AT) return "AT";
  if (d <= PROXIMITY_NEAR) return "NEAR";
  if (d <= PROXIMITY_APPROACHING) return "APPROACHING";
  return "APPROACHING";
}

/** Proximity class for a just-crossed level (always AT for entries, named STOP/TARGET otherwise). */
function proximityForCross(levelName: LevelName): ProximityClass {
  if (levelName === "stop") return "STOP";
  if (levelName === "t1" || levelName === "t2") return "TARGET";
  return "AT";
}

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

function groupBy<T, K>(items: T[], keyOf: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = keyOf(item);
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
  }
  return out;
}

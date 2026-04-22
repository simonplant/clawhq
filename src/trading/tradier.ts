/**
 * Tradier REST client (via cred-proxy).
 *
 * Only the endpoints the trading assistant actually uses:
 *   - GET /v1/markets/quotes?symbols=...   (bulk — one request per poll)
 *   - GET /v1/markets/clock                (authoritative market state)
 *   - GET /v1/accounts/{id}/positions      (Tradier-only positions)
 *   - GET /v1/accounts/{id}/balances       (Tradier balance + day P&L)
 *
 * Auth is handled by cred-proxy on the bridge network — this client never
 * sees a Bearer token. Rate-limit budget is 1 bulk quote/sec (all symbols in
 * one request), well under any documented tier.
 *
 * Tradier quirk: list endpoints return `{key: {inner: T}}` when there's one
 * item, or `{key: {inner: T[]}}` when there are many. The unwrap helper
 * normalizes.
 */

import type { MarketClock, PriceQuote } from "./types.js";

export interface TradierQuote extends PriceQuote {
  /** Intraday high — used for boot reconciliation. */
  dayHigh: number;
  /** Intraday low — used for boot reconciliation. */
  dayLow: number;
  /** Prior close — useful for first-run seeding and context. */
  prevClose: number;
}

export interface TradierPosition {
  symbol: string;
  qty: number;
  avgPrice: number;
  costBasis: number;
}

export interface TradierBalances {
  /** Total equity. */
  totalEquity: number;
  /** Today's P&L — realized + unrealized. */
  dayChange: number;
  /** Cash available. */
  cash: number;
  /** Rolling PDT count (best-effort; Tradier exposes it on margin accounts). */
  pdtCount?: number;
}

export interface TradierClient {
  quotes(symbols: string[]): Promise<TradierQuote[]>;
  clock(): Promise<MarketClock>;
  positions(): Promise<TradierPosition[]>;
  balances(): Promise<TradierBalances>;
}

export interface TradierClientOptions {
  baseUrl: string;
  accountId: string;
  /** Timeout per request (ms). */
  timeoutMs?: number;
}

export class TradierError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "TradierError";
  }
}

export function makeTradierClient(opts: TradierClientOptions): TradierClient {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const base = opts.baseUrl.replace(/\/$/, "");

  async function get<T>(path: string): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}${path}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new TradierError(
          `Tradier GET ${path} failed: ${res.status}`,
          res.status,
          body,
        );
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof TradierError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new TradierError(`Tradier GET ${path} timed out after ${timeoutMs}ms`);
      }
      throw new TradierError(
        `Tradier GET ${path} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async quotes(symbols: string[]): Promise<TradierQuote[]> {
      if (symbols.length === 0) return [];
      const qs = new URLSearchParams({ symbols: symbols.join(","), greeks: "false" });
      const body = await get<QuotesResponse>(`/v1/markets/quotes?${qs.toString()}`);
      const now = Date.now();
      const raw = unwrap(body.quotes?.quote);
      return raw.map((q) => ({
        symbol: q.symbol,
        last: numOrZero(q.last ?? q.close ?? q.prevclose),
        bid: numOrZero(q.bid ?? q.last),
        ask: numOrZero(q.ask ?? q.last),
        tsMs: tradierTs(q.trade_date) ?? tradierTs(q.bid_date) ?? now,
        receivedMs: now,
        dayHigh: numOrZero(q.high),
        dayLow: numOrZero(q.low),
        prevClose: numOrZero(q.prevclose),
      }));
    },

    async clock(): Promise<MarketClock> {
      const body = await get<ClockResponse>(`/v1/markets/clock`);
      const clk = body.clock;
      if (!clk) {
        throw new TradierError("Tradier /v1/markets/clock returned no clock");
      }
      return {
        state: mapState(clk.state),
        nextChangeMs: parseClockMs(clk.next_change, clk.date) ?? Date.now(),
        description: clk.description ?? "",
      };
    },

    async positions(): Promise<TradierPosition[]> {
      if (!opts.accountId) return [];
      const body = await get<PositionsResponse>(
        `/v1/accounts/${encodeURIComponent(opts.accountId)}/positions`,
      );
      // Tradier returns `"positions": "null"` (string) when empty, or an
      // object `{position: ...}` when present. Normalize both shapes.
      const positions = typeof body.positions === "string" ? undefined : body.positions;
      const raw = unwrap(positions?.position);
      return raw.map((p) => ({
        symbol: p.symbol,
        qty: numOrZero(p.quantity),
        avgPrice: p.quantity
          ? numOrZero(p.cost_basis) / numOrZero(p.quantity)
          : 0,
        costBasis: numOrZero(p.cost_basis),
      }));
    },

    async balances(): Promise<TradierBalances> {
      if (!opts.accountId) {
        return { totalEquity: 0, dayChange: 0, cash: 0 };
      }
      const body = await get<BalancesResponse>(
        `/v1/accounts/${encodeURIComponent(opts.accountId)}/balances`,
      );
      const b = body.balances;
      if (!b) return { totalEquity: 0, dayChange: 0, cash: 0 };
      return {
        totalEquity: numOrZero(b.total_equity),
        dayChange: numOrZero(b.close_pl ?? b.day_change),
        cash: numOrZero(b.total_cash ?? b.cash?.cash_available),
        pdtCount: b.pdt_day_trades !== undefined ? Number(b.pdt_day_trades) : undefined,
      };
    },
  };
}

// ── Response shape helpers ───────────────────────────────────────────────────

interface RawQuote {
  symbol: string;
  last?: number | string;
  close?: number | string;
  prevclose?: number | string;
  bid?: number | string;
  ask?: number | string;
  high?: number | string;
  low?: number | string;
  trade_date?: number | string;
  bid_date?: number | string;
}

interface QuotesResponse {
  quotes?: { quote?: RawQuote | RawQuote[] };
}

interface RawClock {
  state?: string;
  next_change?: string;
  date?: string;
  description?: string;
}

interface ClockResponse {
  clock?: RawClock;
}

interface RawPosition {
  symbol: string;
  quantity?: number | string;
  cost_basis?: number | string;
}

interface PositionsResponse {
  positions?: { position?: RawPosition | RawPosition[] } | string;
}

interface RawBalances {
  total_equity?: number | string;
  total_cash?: number | string;
  close_pl?: number | string;
  day_change?: number | string;
  pdt_day_trades?: number | string;
  cash?: { cash_available?: number | string };
}

interface BalancesResponse {
  balances?: RawBalances;
}

// ── Parsing helpers ──────────────────────────────────────────────────────────

function unwrap<T>(value: T | T[] | undefined | string): T[] {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return []; // "null" string on empty positions
  return Array.isArray(value) ? value : [value];
}

function numOrZero(v: unknown): number {
  if (v === undefined || v === null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function tradierTs(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  // Tradier returns epoch ms for trade_date/bid_date; accept as-is.
  return n;
}

function mapState(state: string | undefined): MarketClock["state"] {
  switch (state) {
    case "open":
      return "open";
    case "premarket":
      return "premarket";
    case "postmarket":
    case "afterhours":
      return "postmarket";
    default:
      return "closed";
  }
}

function parseClockMs(nextChange: string | undefined, date: string | undefined): number | null {
  if (!nextChange || !date) return null;
  // Tradier gives "HH:MM" for next_change and "YYYY-MM-DD" for date, both in
  // US/Eastern. We parse conservatively — caller only uses for display.
  const m = /^(\d{2}):(\d{2})$/.exec(nextChange);
  if (!m) return null;
  // Construct as a US/Eastern wall time; JS has no direct TZ parser, so use
  // an ISO string with -05:00 (EST) or -04:00 (EDT) — good enough for UI.
  // The actual market-hours decision uses Tradier's `state` field anyway.
  const iso = `${date}T${m[1]}:${m[2]}:00-05:00`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

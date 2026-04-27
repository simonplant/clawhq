/**
 * VTF (Inner Circle Virtual Trading Floor) alert receiver.
 *
 * A browser-side userscript watches the VTF DOM and POSTs each new alert
 * to the sidecar. This module is the receiver: parse the payload, classify
 * the moderator's verb, dedup within a TTL window. No network, no DB —
 * pure functions. The endpoint in index.ts orchestrates the side effects.
 *
 * VTF alerts are *signals*, not plans. There's no stop or T1 in a Kira
 * message — we relay the moderator's text to Telegram verbatim with
 * attribution. Cross-referencing to today's brief (by ticker) is a
 * future iteration, not this one.
 *
 * Wire contract (v=1):
 *   {
 *     "v":          1,
 *     "seq":        42,                    // optional, monotonic per producer
 *     "user":       "Kira",
 *     "time":       "9:47am",
 *     "ticker":     "AMD",                 // $ prefix optional, normalized
 *     "action":     "long 5/1 90 calls",
 *     "capturedAt": "2026-04-23T16:47:03.123Z"
 *   }
 */

import type { OrderBlock, VtfActionClass, VtfAlert } from "./types.js";

export const VTF_PAYLOAD_VERSION = 1;

/** Dedup TTL — two identical alerts within this window collapse to one. */
export const VTF_DEDUP_TTL_MS = 5 * 60 * 1000;

// ── Parser ──────────────────────────────────────────────────────────────────

export type ParseResult =
  | { ok: true; alert: VtfAlert }
  | { ok: false; reason: string };

/**
 * Validate + shape a raw POST body into a VtfAlert. Never throws.
 * Unknown extra fields are ignored; missing or wrongly-typed required
 * fields produce a descriptive rejection reason.
 */
export function parseVtfInput(raw: unknown, nowMs: number): ParseResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, reason: "body must be a JSON object" };
  }
  const o = raw as Record<string, unknown>;

  if (o.v !== VTF_PAYLOAD_VERSION) {
    return { ok: false, reason: `unsupported payload version ${String(o.v)}` };
  }
  const user = requireString(o.user);
  if (!user) return { ok: false, reason: "missing or empty 'user'" };
  const time = requireString(o.time);
  if (!time) return { ok: false, reason: "missing or empty 'time'" };
  const tickerRaw = requireString(o.ticker);
  if (!tickerRaw) return { ok: false, reason: "missing or empty 'ticker'" };
  const action = requireString(o.action);
  if (!action) return { ok: false, reason: "missing or empty 'action'" };
  const capturedAt = requireString(o.capturedAt);
  if (!capturedAt) return { ok: false, reason: "missing or empty 'capturedAt'" };

  const seq =
    typeof o.seq === "number" && Number.isFinite(o.seq) ? o.seq : undefined;

  const ticker = normalizeTicker(tickerRaw);
  const actionClass = classifyAction(action);

  const alert: VtfAlert = {
    user: user.trim(),
    time: time.trim(),
    ticker,
    action: action.trim(),
    actionClass,
    capturedAt,
    seq,
    dedupKey: makeDedupKey({
      user: user.trim(),
      time: time.trim(),
      ticker,
      action: action.trim(),
    }),
    receivedMs: nowMs,
  };
  return { ok: true, alert };
}

function requireString(x: unknown): string | undefined {
  if (typeof x !== "string") return undefined;
  if (x.trim().length === 0) return undefined;
  return x;
}

/**
 * Strip a leading `$`, trim, upper-case. VTF renders tickers as `$AMD`;
 * the brief uses `AMD`. Normalize to the brief shape so cross-ref works.
 */
export function normalizeTicker(raw: string): string {
  return raw.trim().replace(/^\$/, "").toUpperCase();
}

/** Stable dedup key. Whitespace-collapsed and lowercased action text. */
export function makeDedupKey(parts: {
  user: string;
  time: string;
  ticker: string;
  action: string;
}): string {
  const action = parts.action.replace(/\s+/g, " ").toLowerCase().trim();
  return `${parts.user.toLowerCase()}|${parts.time}|${parts.ticker}|${action}`;
}

// ── Classifier ──────────────────────────────────────────────────────────────

/**
 * Best-effort class from free-text moderator action.
 * Priority matters — `stopped out` must match before `out` if we add it;
 * `trimmed` before `added`; `flat` always wins when present.
 */
export function classifyAction(action: string): VtfActionClass {
  const s = action.toLowerCase();
  // Short check comes before flat so "sold short" doesn't match "sold".
  if (/\bsold\s+short\b/.test(s)) return "short";
  // Exits — a "flat" or "stopped" alert is a closing action even if the
  // ticker is a long name.
  if (/\b(flat|closed|sold|out)\b/.test(s)) return "flat";
  if (/\bstopped\b/.test(s)) return "stopped";
  if (/\btrim(?:med)?\b/.test(s)) return "trimmed";
  if (/\badd(?:ed)?\b/.test(s)) return "added";
  // Directions.
  if (/\b(long|buying|bought)\b/.test(s)) return "long";
  if (/\b(short|shorting)\b/.test(s)) return "short";
  return "other";
}

// ── Dedup ───────────────────────────────────────────────────────────────────

export interface VtfDedup {
  /**
   * Record an incoming key. Returns "duplicate" if already seen within
   * ttlMs; "new" otherwise. New keys are stored with their receipt time.
   */
  check(key: string, nowMs: number): "new" | "duplicate";
  /** Remove expired entries. Called opportunistically on each check. */
  size(): number;
  /** For tests. */
  clear(): void;
}

export interface VtfDedupOptions {
  ttlMs?: number;
}

export function makeVtfDedup(opts: VtfDedupOptions = {}): VtfDedup {
  const ttl = opts.ttlMs ?? VTF_DEDUP_TTL_MS;
  const seen = new Map<string, number>();

  function gcIfLarge(nowMs: number): void {
    if (seen.size < 1024) return;
    for (const [k, at] of seen) {
      if (nowMs - at > ttl) seen.delete(k);
    }
  }

  return {
    check(key, nowMs): "new" | "duplicate" {
      const last = seen.get(key);
      if (last !== undefined && nowMs - last <= ttl) {
        return "duplicate";
      }
      seen.set(key, nowMs);
      gcIfLarge(nowMs);
      return "new";
    },
    size(): number {
      return seen.size;
    },
    clear(): void {
      seen.clear();
    },
  };
}

// ── Presentation ────────────────────────────────────────────────────────────

/**
 * Icon prefix for the Telegram relay. Short, glanceable, no ambiguity with
 * the existing alert icons (📈 / 🛑 / 🎯 / 🔁).
 */
export function vtfIcon(cls: VtfActionClass): string {
  switch (cls) {
    case "long":
      return "🟢";
    case "short":
      return "🔴";
    case "flat":
      return "⚪";
    case "stopped":
      return "🛑";
    case "trimmed":
      return "✂️";
    case "added":
      return "➕";
    case "other":
      return "🎯";
  }
}

export interface VtfRelayContext {
  /**
   * Optional — if set and contains a ticker-scoped or "all" blackout,
   * the relay message gets an inline `⚠ blackout: <name>` annotation.
   */
  activeBlackouts?: Array<{
    scope: "all" | { ticker: string };
    name: string;
    reason: string;
  }>;
  /**
   * Today's plan orders. When a VTF long/short matches the brief's
   * ticker, the relay annotates with the matching ORDER — turns the
   * moderator message into "Kira is executing the thing you already
   * planned" vs. "Kira is trading something not in your brief".
   */
  planOrders?: OrderBlock[];
}

/**
 * Case-insensitive ticker match against the plan's orders. Returns only
 * orders whose status is still open (ACTIVE / CONDITIONAL / TRIGGERED).
 */
export function matchPlanOrders(
  ticker: string,
  orders: OrderBlock[] | undefined,
): OrderBlock[] {
  if (!orders) return [];
  const t = ticker.toUpperCase();
  return orders.filter(
    (o) =>
      o.ticker.toUpperCase() === t &&
      (o.status === "ACTIVE" ||
        o.status === "CONDITIONAL" ||
        o.status === "TRIGGERED"),
  );
}

/**
 * Map a VTF action class to a brief direction, or undefined if the
 * signal doesn't correspond to a new directional position.
 */
function directionFromActionClass(cls: VtfActionClass): "LONG" | "SHORT" | undefined {
  if (cls === "long") return "LONG";
  if (cls === "short") return "SHORT";
  return undefined;
}

interface PlanMatchAnnotation {
  /** Human-readable line for the relay. Empty when no meaningful match. */
  line: string;
  /** True if VTF direction conflicts with the matched order's direction. */
  conflict: boolean;
}

function annotatePlanMatch(
  alert: VtfAlert,
  matches: OrderBlock[],
): PlanMatchAnnotation | undefined {
  if (matches.length === 0) return undefined;
  const vtfDir = directionFromActionClass(alert.actionClass);
  if (!vtfDir) return undefined;

  // Prefer a match whose direction agrees; if none agrees, surface the
  // first conflicting match so Simon sees the divergence.
  const agreeing = matches.find((m) => m.direction === vtfDir);
  if (agreeing) {
    return {
      line: `matches ${agreeing.source.toUpperCase()} ORDER ${agreeing.sequence} ${agreeing.direction} @ ${formatOrderPrice(agreeing.entry)}`,
      conflict: false,
    };
  }
  const conflicting = matches[0];
  if (!conflicting) return undefined;
  return {
    line: `⚠ conflicts with ${conflicting.source.toUpperCase()} ORDER ${conflicting.sequence} ${conflicting.direction} @ ${formatOrderPrice(conflicting.entry)}`,
    conflict: true,
  };
}

function formatOrderPrice(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Format a one-line Telegram message for a VTF alert. Not a full alert
 * body — VTF relays are informational, not trade plans. Keeps the
 * formatter small and its tests mechanical.
 */
export function formatVtfMessage(
  alert: VtfAlert,
  ctx: VtfRelayContext = {},
): string {
  const icon = vtfIcon(alert.actionClass);
  const head = `${icon} VTF ${alert.user} — ${alert.ticker} ${alert.action}`;
  const blackout = matchingBlackout(alert.ticker, ctx.activeBlackouts);
  const planAnnotation = annotatePlanMatch(
    alert,
    matchPlanOrders(alert.ticker, ctx.planOrders),
  );
  const bits = [head, `time ${alert.time}`];
  if (planAnnotation) bits.push(planAnnotation.line);
  if (blackout) bits.push(`⚠ blackout: ${blackout.name} — ${blackout.reason}`);
  return bits.join(" · ");
}

function matchingBlackout(
  ticker: string,
  blackouts: VtfRelayContext["activeBlackouts"],
): { name: string; reason: string } | undefined {
  if (!blackouts) return undefined;
  for (const b of blackouts) {
    if (b.scope === "all") return { name: b.name, reason: b.reason };
    if (b.scope.ticker.toUpperCase() === ticker.toUpperCase()) {
      return { name: b.name, reason: b.reason };
    }
  }
  return undefined;
}

/**
 * Whether the Telegram notification should be silent. Loud for entries
 * and stops (real execution), quiet for trims/adds/flats (informational
 * bookkeeping that shouldn't wake Simon).
 */
export function vtfShouldQuiet(cls: VtfActionClass): boolean {
  return cls === "trimmed" || cls === "added" || cls === "flat";
}

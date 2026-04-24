/**
 * Confluence scoring over a loaded plan.
 *
 * The `confluence` field on OrderBlock is a string written by the extractor
 * skills (dp-parse, mancini-fetch, premarket-brief). Useful for humans, but
 * fragile for automation — typos, stale tags, omissions. This module
 * derives a numeric score from the *loaded* orders themselves, purely by
 * cross-referencing ticker + direction + entry proximity across sources.
 *
 * It answers: "for each order, is another source flagging the same trade
 * at a comparable level, and in the same direction?"
 *
 *   - aligned        : ≥2 sources, same direction, entries within 1%
 *   - strong-aligned : aligned AND all contributing convictions are HIGH
 *   - divergent      : same ticker, different sources, OPPOSITE direction
 *   - none           : single-source
 *
 * Pure, deterministic, no I/O. Call after loadPlan() and before alerting.
 */

import type {
  ConfluenceSnapshot,
  ConfluenceTier,
  OrderBlock,
  Source,
} from "./types.js";

// Re-export tier type so the single import surface for consumers is confluence.ts.
export type { ConfluenceTier } from "./types.js";

/** Fraction of entry within which two orders count as "same level". */
export const CONFLUENCE_PROXIMITY_FRACTION = 0.01;

export interface ConfluenceFinding {
  orderId: string;
  /** Sources contributing to the alignment, self included, deduped and sorted. */
  sources: Source[];
  /** 0–100; 50 is single-source baseline. */
  score: number;
  tier: ConfluenceTier;
  /** Human-readable summary suitable for alert annotation. */
  label: string;
}

export type ConfluenceMap = Map<string, ConfluenceFinding>;

/** Per-source quality multiplier, clamped to [0.85, 1.15] before use. */
export type SourceQuality = Partial<Record<Source, number>>;

export interface ComputeConfluenceOptions {
  /**
   * Per-source quality multiplier derived from track-record (see
   * qualityFromAggregates). Applied ONLY to the "aligned" tier — strong-
   * aligned and divergent are grounded in declared-HIGH conviction and
   * shouldn't drift on recent outcomes alone.
   */
  sourceQuality?: SourceQuality;
}

const QUALITY_MIN = 0.85;
const QUALITY_MAX = 1.15;

/**
 * Produce confluence findings for every order in the plan.
 * Missing orders in the returned map is not possible — even single-source
 * orders get a `none`-tier entry so callers can unconditionally look up.
 */
export function computeConfluence(
  orders: OrderBlock[],
  opts: ComputeConfluenceOptions = {},
): ConfluenceMap {
  const byTicker = new Map<string, OrderBlock[]>();
  for (const o of orders) {
    const key = o.ticker.toUpperCase();
    const bucket = byTicker.get(key);
    if (bucket) bucket.push(o);
    else byTicker.set(key, [o]);
  }

  const out: ConfluenceMap = new Map();
  for (const o of orders) {
    const group = byTicker.get(o.ticker.toUpperCase()) ?? [];
    out.set(o.id, adjustForQuality(classify(o, group), opts.sourceQuality));
  }
  return out;
}

/**
 * Apply the per-source quality multiplier to aligned findings only.
 * Strong-aligned and divergent tiers reflect structural facts
 * (declared-HIGH alignment or declared-direction conflict) that recent
 * track-record shouldn't override. Score is clamped to [0, 100].
 */
function adjustForQuality(
  finding: ConfluenceFinding,
  quality: SourceQuality | undefined,
): ConfluenceFinding {
  if (!quality || finding.tier !== "aligned") return finding;
  let factor = 1;
  for (const s of finding.sources) {
    const q = quality[s];
    if (q === undefined) continue;
    const clamped = Math.max(QUALITY_MIN, Math.min(QUALITY_MAX, q));
    factor *= clamped;
  }
  // Mean instead of product would be less volatile; keeping product so that
  // two aligned weak sources compound their penalty (intended).
  const scaled = Math.round(finding.score * factor);
  const score = Math.max(0, Math.min(100, scaled));
  if (score === finding.score) return finding;
  return { ...finding, score };
}

function classify(self: OrderBlock, group: OrderBlock[]): ConfluenceFinding {
  // Same-direction peers within entry proximity and from a different source.
  const aligned: OrderBlock[] = [self];
  let divergentPeer: OrderBlock | undefined;

  for (const peer of group) {
    if (peer.id === self.id) continue;
    if (peer.source === self.source) continue; // alignment requires cross-source
    if (!nearby(self.entry, peer.entry)) {
      // Entries too far apart to count — but opposite-direction still flags
      // as divergent only if it's within a wider band. Use 5% for divergence.
      if (withinFraction(self.entry, peer.entry, 0.05) && peer.direction !== self.direction) {
        divergentPeer = divergentPeer ?? peer;
      }
      continue;
    }
    if (peer.direction !== self.direction) {
      divergentPeer = divergentPeer ?? peer;
      continue;
    }
    aligned.push(peer);
  }

  // Divergent wins — a same-name bull/bear split is a meaningful warning
  // even if there's also an aligned peer.
  if (divergentPeer) {
    return {
      orderId: self.id,
      sources: dedupSources([self.source, divergentPeer.source]),
      score: 25,
      tier: "divergent",
      label: `divergence vs ${divergentPeer.source} (${divergentPeer.direction} @ ${formatPrice(divergentPeer.entry)})`,
    };
  }

  if (aligned.length === 1) {
    return {
      orderId: self.id,
      sources: [self.source],
      score: 50,
      tier: "none",
      label: "single-source",
    };
  }

  const sources = dedupSources(aligned.map((o) => o.source));
  const allHigh = aligned.every((o) => o.conviction === "HIGH");
  if (allHigh && sources.length >= 2) {
    return {
      orderId: self.id,
      sources,
      score: Math.min(100, 65 + 15 * (sources.length - 2) + 10),
      tier: "strong-aligned",
      label: `strong-aligned: ${sources.join("+")} all HIGH`,
    };
  }

  return {
    orderId: self.id,
    sources,
    score: Math.min(100, 65 + 15 * (sources.length - 2)),
    tier: "aligned",
    label: `aligned: ${sources.join("+")}`,
  };
}

function nearby(a: number, b: number): boolean {
  return withinFraction(a, b, CONFLUENCE_PROXIMITY_FRACTION);
}

function withinFraction(a: number, b: number, frac: number): boolean {
  if (a === 0 || b === 0) return a === b;
  const ref = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) / ref <= frac;
}

function dedupSources(sources: Source[]): Source[] {
  const seen = new Set<Source>();
  const out: Source[] = [];
  for (const s of sources) {
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.sort();
}

function formatPrice(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// ── Convenience helpers ──────────────────────────────────────────────────────

/**
 * Rank orders by descending confluence score, stable on equal scores by
 * original sequence. Useful for the premarket brief's "top setups" section.
 */
export function rankByConfluence(
  orders: OrderBlock[],
  findings: ConfluenceMap,
): OrderBlock[] {
  return [...orders].sort((a, b) => {
    const sa = findings.get(a.id)?.score ?? 0;
    const sb = findings.get(b.id)?.score ?? 0;
    if (sb !== sa) return sb - sa;
    return a.sequence - b.sequence;
  });
}

/**
 * Pick the tier label that should prefix an alert — mirrors the scoring
 * but intentionally conservative: we show "divergent" (a warning) more
 * loudly than "strong-aligned" (encouragement).
 */
export function alertBadge(tier: ConfluenceTier): string {
  switch (tier) {
    case "divergent":
      return "⚠ DIVERGENT";
    case "strong-aligned":
      return "✦ STRONG-ALIGNED";
    case "aligned":
      return "✓ ALIGNED";
    case "none":
      return "";
  }
}

/** Lower a finding to the compact snapshot carried on Alert events. */
export function toSnapshot(finding: ConfluenceFinding): ConfluenceSnapshot {
  return { tier: finding.tier, score: finding.score, label: finding.label };
}

/**
 * Derive per-source quality multipliers from track-record aggregates.
 *
 * Intentionally conservative:
 *   winRate ≥ 0.60 AND closed ≥ MIN_SAMPLE → 1.10 (promote)
 *   winRate ≤ 0.35 AND closed ≥ MIN_SAMPLE → 0.90 (demote)
 *   else 1.0 (neutral)
 *
 * Sources without enough samples stay neutral — we don't amplify noise
 * from five trades worth of history. Returns only non-neutral entries so
 * callers can treat missing as 1.0.
 */
export function qualityFromAggregates(
  aggregates: Array<{
    key: { source: Source };
    wins: number;
    losses: number;
    winRate: number;
  }>,
): SourceQuality {
  const MIN_SAMPLE = 10;
  const bySource = new Map<Source, { wins: number; losses: number }>();
  for (const a of aggregates) {
    const cur = bySource.get(a.key.source) ?? { wins: 0, losses: 0 };
    cur.wins += a.wins;
    cur.losses += a.losses;
    bySource.set(a.key.source, cur);
  }

  const out: SourceQuality = {};
  for (const [source, totals] of bySource) {
    const closed = totals.wins + totals.losses;
    if (closed < MIN_SAMPLE) continue;
    const winRate = totals.wins / closed;
    if (winRate >= 0.6) out[source] = 1.1;
    else if (winRate <= 0.35) out[source] = 0.9;
  }
  return out;
}

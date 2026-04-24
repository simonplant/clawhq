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

/**
 * Produce confluence findings for every order in the plan.
 * Missing orders in the returned map is not possible — even single-source
 * orders get a `none`-tier entry so callers can unconditionally look up.
 */
export function computeConfluence(orders: OrderBlock[]): ConfluenceMap {
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
    out.set(o.id, classify(o, group));
  }
  return out;
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

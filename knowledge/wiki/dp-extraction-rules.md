---
tags: [extraction, dp, am-call, vtf, order-format]
date: 2026-04-15
source-count: 1
confidence: established
last-verified: 2026-04-15
---

# DP Extraction Rules

How to parse DP's AM Call transcriptions and VTF alerts into ORDER blocks.

## AM Call Parsing

### Speech-to-Text Cleanup

Apply before parsing (dp-brief tool handles this automatically):

**Ticker fixes:** "the Qs"/"queues" → QQQ. "the spy" → SPY. "GE Vinova" → GEV. "mera"/"emta" → META. Company names → tickers (Palantir→PLTR, Snowflake→SNOW).

**Price fixes:** "58463" → 584.63. Sanity ranges: SPY 400-700, QQQ 350-650, META 300-700. Outside range → flag VERIFY.

**Position detection:** "I am/I'm short" → SHORT. "bought"/"lazy long" → LONG. "sold most"/"got flat" → CLOSED. "I'm a buyer at X" → ENTRY INTENT (not yet in).

### Extraction for Each Stock

1. **Actionable level?** Specific price or MA named as entry
2. **Direction?** Long, short, or observation only
3. **Conviction?** See [[dp-conviction-scoring]]
4. **Trade type?** CORE_SWING, PLANNED, EVENT, RS, SCALP (see [[dp-methodology]])

### Entry
- DP states price → entry = that price
- "On a pullback to MA" → entry = MA level (flag VERIFY if unknown)
- "Immediately"/"now" → entry_type = MARKET

### Stop
- DP states stop → use his level
- No stop stated → entry - 2% (longs) or entry + 2% (shorts)
- "Tight stop" → 1%. "Give it room" → 3%.

### Targets
- DP states targets → t1 = lower, t2 = upper
- One stated → t1 = stated, t2 = t1 + 2%
- None → t1 = ±3%, t2 = ±5% (flag "estimated")

## VTF Alert Parsing

Short-form action lines. Detect by:
- Action words: SHORT, LONG, COVERED, TRIMMED, FLAT, ADDED, SOLD
- Known tickers with or without $
- DP-style typos: mera, emta, coverd, shrot
- Simon says "VTF", "DP alerts", "parse this"

**Mapping:**
- SHORT/LONG → `trade-journal log B <side> <qty> <symbol> --execute`
- COVERED/FLAT → `trade-journal close B <symbol> --execute`
- TRIMMED/SOLD → `trade-journal close B <symbol> --qty <partial> --execute`
- ADDED → `trade-journal log B <side> <qty> <symbol> --notes "added" --execute`

VTF execution is **mechanical** — mirror DP exactly.

## Standard ORDER Format Output

See [[standard-order-format]]. DP-specific fields:
- `source: dp`, `pot: B`
- Active positions go in CONTEXT block (not ORDER blocks)
- Analyst actions → ANALYST ACTIONS section (supplementary, context only)
- Sector themes → SECTOR THEMES section (context only)

## What Is Extracted vs Derived vs Never Fabricated

**Extracted:** Stated prices, positions, conviction language verbatim, analyst actions, bias, outlook, catalysts.

**Derived:** Conviction from language table. Stop = stated or MA-2%. Targets = stated or +3%/+5%. Size from risk/distance.

**Never fabricated:** Prices DP didn't mention. Conviction not grounded in his language. Targets labeled as "DP's" when estimated.

## Related

- [[dp-methodology]] — Core trading system
- [[dp-conviction-scoring]] — Language → conviction + sizing
- [[standard-order-format]] — Unified ORDER block spec
- [[mancini-extraction-rules]] — Mancini's equivalent

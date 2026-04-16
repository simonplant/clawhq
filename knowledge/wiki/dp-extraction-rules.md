---
tags: [extraction, dp, am-call, vtf, conviction, order-format]
date: 2026-04-16
source-count: 2
confidence: established
last-verified: 2026-04-16
---

# DP Extraction Rules

How to parse DP's AM Call transcriptions and VTF alerts into the daily brief and ORDER blocks.

## Conviction Scoring

How to map David Prince's language to conviction levels. Used when parsing AM Calls and by the heartbeat when evaluating ORDER blocks.

### Language -> Conviction

**HIGH (0.70+) — Full size, LIMIT order**
- "My favorite name", "go nuts", "game time", "definitely a buyer"
- "Sizable position at X", "I'm aggressive here"
- Voice rises with excitement — "game time" signal
- Quality name at key MA (21d or 200d) with earnings support

**MEDIUM (0.50-0.69) — Half size, LIMIT at level**
- "I'm a buyer at X", "I'd be interested at X"
- "It'd be buyable at X", "where might it be viable"
- "I'd probably add" — building on existing position
- Level identified but entry conditional ("if it pulls back")

**LOW (0.30-0.49) — Watch only, no order**
- "Cute short", "might be a cute short"
- "Not excited", "lazy long"
- Level mentioned without conviction language

**AVOID (<0.30) — Skip entirely**
- "Not right", "something's off", "off the table"
- "Don't chase" — gap killed the setup

**Only HIGH and MEDIUM generate ORDER blocks.** LOW -> WATCH section. AVOID -> omit.

### Position Actions (Language -> Signal)

| DP says | Signal |
|---------|--------|
| "Started a short/long" | NEW position |
| "Added to" | SIZING into existing |
| "Sold most of" | TRIMMING winner |
| "Got flat" | CLOSED position |
| "Lazy long" | LOW conviction entry |
| "Gifting positions" | Holding overnight to trim next day |

## AM Call Parsing

### Speech-to-Text Cleanup

Apply before parsing (dp-brief tool handles this automatically):

**Ticker fixes:** "the Qs"/"queues" -> QQQ. "the spy" -> SPY. "GE Vinova" -> GEV. "mera"/"emta" -> META. Company names -> tickers (Palantir->PLTR, Snowflake->SNOW).

**Price fixes:** "58463" -> 584.63. Sanity ranges: SPY 400-700, QQQ 350-650, META 300-700. Outside range -> flag VERIFY.

**Position detection:** "I am/I'm short" -> SHORT. "bought"/"lazy long" -> LONG. "sold most"/"got flat" -> CLOSED. "I'm a buyer at X" -> ENTRY INTENT (not yet in).

### Extraction for Each Stock

1. **Actionable level?** Specific price or MA named as entry
2. **Direction?** Long, short, or observation only
3. **Conviction?** Map language using the scoring table above
4. **Trade type?** CORE_SWING, PLANNED, EVENT, RS, SCALP (see [[dp-methodology]])

### Entry
- DP states price -> entry = that price
- "On a pullback to MA" -> entry = MA level (flag VERIFY if unknown)
- "Immediately"/"now" -> entry_type = MARKET

### Stop
- DP states stop -> use his level
- No stop stated -> entry - 2% (longs) or entry + 2% (shorts)
- "Tight stop" -> 1%. "Give it room" -> 3%.

### Targets
- DP states targets -> t1 = lower, t2 = upper
- One stated -> t1 = stated, t2 = t1 + 2%
- None -> t1 = +3%, t2 = +5% (flag "estimated")

### AM Call -> Watchlist, NOT Orders

The AM Call produces a **WATCHLIST** with ideal levels, not executable ORDER blocks. DP's levels are thesis-grade (aspirational). Moderators (Kira, Rickman) regularly enter above these levels. ORDER blocks only come from VTF alerts or moderator trades.

## VTF Alert Parsing

Short-form action lines. Detect by:
- Action words: SHORT, LONG, COVERED, TRIMMED, FLAT, ADDED, SOLD
- Known tickers with or without $
- DP-style typos: mera, emta, coverd, shrot

**Mapping:**
- SHORT/LONG -> `trade-journal log <side> <qty> <symbol> --execute`
- COVERED/FLAT -> `trade-journal close <symbol> --execute`
- TRIMMED/SOLD -> `trade-journal close <symbol> --qty <partial> --execute`
- ADDED -> `trade-journal log <side> <qty> <symbol> --notes "added" --execute`

VTF execution is **mechanical** — mirror DP exactly. Entry = current market price (not AM Call level).

## Standard ORDER Format Output

See [[standard-order-format]]. DP-specific fields:
- `source: dp`, `accounts: tos,ira,tradier` (IRA excludes short ideas)
- Active positions go in CONTEXT block (not ORDER blocks)
- Analyst actions -> ANALYST ACTIONS section (supplementary, context only)
- Sector themes -> SECTOR THEMES section (context only)

## What Is Extracted vs Derived vs Never Fabricated

**Extracted:** Stated prices, positions, conviction language verbatim, analyst actions, bias, outlook, catalysts.

**Derived:** Conviction from language table. Stop = stated or MA-2%. Targets = stated or +3%/+5%. Size from risk/distance.

**Never fabricated:** Prices DP didn't mention. Conviction not grounded in his language. Targets labeled as "DP's" when estimated.

## Related

- [[dp-methodology]] — Core trading system
- [[standard-order-format]] — Unified ORDER block spec
- [[account-system]] — Account sizing and constraints
- [[mancini-extraction-rules]] — Mancini's equivalent

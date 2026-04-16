# DP AM CALL EXTRACTOR

## Purpose

Extract trade orders from David Prince's morning call transcript. Output in the standard order format that OpenClaw writes into `memory/trading-YYYY-MM-DD.md`.

---

## INPUT

DP's AM Call transcript from Dropbox speech-to-text. Simon pastes into Telegram ~5:30 AM PT. May arrive pre-processed by `dp-brief` (structured) or raw (needs full parsing).

## OUTPUT

The standard `## Orders` block defined at the end of this document. Same format as Mancini extractor output. Same format as any future source extractor output.

---

## SPEECH-TO-TEXT CLEANUP

Apply before parsing if raw transcript (dp-brief handles this if pre-processed):

**Ticker fixes:** "the Qs"/"queues" → QQQ. "the spy" → SPY. "GE Vinova"/"GE Vernova" → GEV. "mera"/"emta" → META. Company names → tickers (Palantir→PLTR, Snowflake→SNOW, etc.)

**Ticker typos:** mera→META, qqqq→QQQ, nividia→NVDA, telsa→TSLA, appl→AAPL, mircosoft→MSFT

**Price fixes:** Numbers without decimals in stock context: "58463" → 584.63. Sanity check: SPY 400-700, QQQ 350-650, META 300-700, NVDA 80-250. If outside range, flag ⚠️ VERIFY.

**Position detection:** "I am/I'm short" → SHORT. "I'm long"/"bought"/"lazy long" → LONG. "sold most"/"got flat"/"covered" → CLOSED. "I'm a buyer at X" → ENTRY INTENT (not yet in).

---

## EXTRACTION RULES

### Locate setups

DP embeds trade ideas throughout the call. For each stock he discusses, determine:

1. **Is there an actionable level?** A specific price or MA he names as entry.
2. **What's the direction?** Long (buy), short, or observation only.
3. **What's the conviction?** From his language (see table below).
4. **What's the trade type?** Core swing, planned, event, RS, scalp.

### Entry

```
if DP states a specific price    → entry = that price
if DP says "on a pullback" to MA → entry = MA level (flag VERIFY if MA value unknown)
if DP says "immediately"/"now"   → entry_type = MARKET
```

**MA hierarchy** (when no price stated): 21-day → 10-day → 8-day → 200-day → VWAP.

If MA value is unknown: `verify: "need current [X]-day MA for [TICKER]"`

### Stop

```
if DP states a stop → stop = his level
if no stop stated   → stop = entry - 2% (longs) or entry + 2% (shorts)
```

"Tight stop" → 1%. "Give it room" → 3%.

### Targets

```
if DP states targets → t1 = lower target, t2 = upper target
if DP states one     → t1 = stated, t2 = t1 + 2%
if none stated       → t1 = entry ± 3%, t2 = entry ± 5% (flag "estimated")
```

### Sizing

1% of pot per trade risk ($333 on $33K Pot B). Max 15% of pot per position (~$5K). Max 3-4 concurrent. Max 60% exposure.

### Conviction mapping

| His language | Conviction |
|-------------|-----------|
| "My favorite name", "go nuts", "game time", "definitely a buyer", "sizable position", "I'm aggressive" | HIGH |
| "I'm a buyer at X", "I'd be interested", "buyable at X", "I'd probably add" | HIGH |
| "Cute short", "might work", "lazy long", "not excited but possible" | LOW |
| "Not right", "something's off", "off the table", "don't chase" | Exclude — no order |

**Only HIGH and MEDIUM generate orders.** LOW = watch list. Exclude = omit entirely.

### Trade type classification

| Type | DP signals | Hold | Sizing |
|------|-----------|------|--------|
| CORE_SWING | "building a position", "my favorite", named MA entry | days-weeks | full |
| PLANNED | "if it pulls back to X", specific level + catalyst | day-swing | full |
| EVENT | earnings play, "positive into the print", "day-after-trade" | day | moderate |
| RS | "showing relative strength", "red-to-green" | intraday-day | moderate |
| SCALP | quick momentum, no pre-plan | minutes-hours | half |

### Active positions vs. new orders

"I am short META" = existing position, track but don't generate a new order.
"I'm a buyer at X" = entry intent, generate an order.
Keep these separate.

### Analyst actions

Upgrades, downgrades, PT changes — extract for context. Only generate an order if DP explicitly endorses: "I'm a buyer because of this upgrade."

### Sector themes

"Homebuilders look good", "semis leading" — context, not orders.

---

## WHAT IS EXTRACTED vs. DERIVED vs. NEVER FABRICATED

**Extracted directly:** Stated prices, active positions, conviction language (verbatim), analyst actions, bias, outlook, catalysts, sector themes.

**Derived mechanically:** Conviction from language table. Stop = stated or MA-2%. Targets = stated or +3%/+5%. Size from risk/distance. Trade type from signal patterns.

**Never fabricated:** Prices DP didn't mention. Conviction not grounded in his language. Targets labeled as "DP's" when estimated. Analyst opinions attributed to DP. Direction calls DP didn't make.

---

## STANDARD OUTPUT FORMAT

Both DP and Mancini extractors produce this IDENTICAL format. OpenClaw reads one format.

```
=== TRADE PLAN: [source] | [date] ===

CONTEXT:
  source:    dp
  bias:      [BULLISH / LEAN BULLISH / MIXED / LEAN BEARISH / BEARISH]
  outlook:   [his summary ≤20 words]
  positions: [SHORT META @ 583, LONG NVDA @ 118] or "flat"
  calendar:  [risk events today]

---

ORDER 1 | [conviction] | [status]
  source:     dp
  pot:        B
  ticker:     AMZN
  exec_as:    AMZN
  direction:  LONG
  setup:      PLANNED — "[his words about this trade ≤20 words]"
  why:        [what makes this actionable ≤15 words]
  entry:      [price] LMT
  stop:       [price] — [source: DP stated / MA-2% / derived]
  t1:         [price] (75%) — [source: DP stated / next R / estimated]
  t2:         [price] (15%) — [source: DP stated / estimated]
  runner:     10% trail BE after T1
  risk:       [dollars] per share | [qty] shares | $[total risk]
  caveat:     [his warning verbatim or "none"]
  kills:      [dp_flat, gap_killed, etc.]
  activation: [for CONDITIONAL: what must happen, or "immediate"]
  verify:     [what needs checking, or "none"]

ORDER 2 | [conviction] | [status]
  [same fields]

ORDER 3 | ...

---

WATCH:
  - [ticker] [level]: [reason ≤15 words] (LOW)

---

ANALYST ACTIONS:
  - [TICKER]: [firm] [action] PT $[target] — [DP's take or "no comment"]

---

DAT CANDIDATES:
  - [TICKER]: [event] — [DP's lean]

---

SECTOR THEMES:
  - [theme ≤10 words]
```

### Notes on this format

- **Plain text, not markdown tables.** Easier for a local LLM to parse reliably.
- **Key: value pairs.** Predictable, greppable, no ambiguity.
- **Same field names as Mancini extractor.** `source`, `pot`, `ticker`, `exec_as`, `direction`, `entry`, `stop`, `t1`, `t2`, `risk`, `conviction`, `status`, `kills`, `activation`, `verify`.
- **ORDER blocks are self-contained.** Each one has everything needed to monitor and execute.
- **The CONTEXT block is source-specific.** DP has positions and outlook. Mancini has runners and chop zones. Both use the same label pattern under CONTEXT.
- **WATCH, ANALYST ACTIONS, DAT CANDIDATES, SECTOR THEMES** are supplementary. Agent monitors ORDER blocks only. Supplementary sections are for Simon's context and Pot A thesis generation.

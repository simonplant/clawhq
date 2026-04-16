# MANCINI NEWSLETTER EXTRACTOR

## Purpose

Extract trade orders from Adam Mancini's daily ES/SPX newsletter. Output in the standard order format that OpenClaw writes into `memory/trading-YYYY-MM-DD.md`.

---

## INPUT

Mancini's daily Substack newsletter (~5000 words). Fetched by `mancini-fetch` cron at 2:30 PM PT.

## OUTPUT

The standard `## Orders` block defined at the end of this document. Same format as DP extractor output. Same format as any future source extractor output.

---

## SKIP LIST

75% of every newsletter is identical boilerplate. Skip everything before "Trade Plan [Day]":

- "The Run Down on The Level To Level Approach"
- "The Golden Rule" / 90% of days don't trend
- "Elevator Down, Failed Breakdown, Short Squeeze" cycle
- "Don't predict" philosophy
- Housekeeping / contract roll notices
- "What profitable trading looks like" / mentor story
- Acceptance pattern diagrams and textbook explanations
- Runner philosophy (free lotto ticket, FOMO control, etc.)
- Trade recap / daily summary (backward-looking)
- The closing "no crystal balls" paragraph

Start extraction at "Trade Plan [Day]".

---

## EXTRACTION RULES

### Locate setups

In the "In terms of lvls I'd bid" prose, Mancini describes setups as conditional chains. For each:

1. **Identify the significant low** — the level he names as anchor
2. **Classify**: "flush and recover" → FB. "reclaim of" → RECLAIM. "one could bid" → DIRECT_BID. "short beneath" → SHORT (reference only).
3. **Identify flush target** — "ideal if tags [X]", "perhaps to [X]"
4. **Check for kill language** — "would not bid" → exclude. "too well tested" → exclude unless "but if flush and recover" (then CONDITIONAL). "don't touch if knifing" → kill condition.
5. **Note his quality word** verbatim

### Entry (NAP rule)

Mancini's Non-Acceptance Protocol is the only entry method compatible with limit orders:

```
entry = significant_low + 5
```

The +5 clears his "danger zone" (0-5pts above significant low where most FB losses occur). This is his own rule for fast/unclear situations. On deep flushes with clear acceptance, a manual entry closer to the low would be tighter.

### Stop

```
if flush_target stated → stop = flush_target - 4
if no flush_target     → stop = next support level below significant_low (from his levels list)
```

Never invent buffer numbers. Always anchor to a level he provides. If next support is >20pts away, flag as WIDE STOP.

### Targets

```
T1 = first level ≥ 8pts above entry (from his levels list, prefer majors)
T2 = next level ≥ 8pts above T1
```

Why ≥8pts: his "level to level" moves are 8-15pts. Locking 75% at +2pts is noise.

### Position split

75% at T1 / 15% at T2 / 10% runner. Move stop to BE after T1.

### Conviction mapping

| His words | Conviction |
|-----------|-----------|
| "A+", "powerful", "clear significant low", "I get very interested" | HIGH |
| "quality Failed Breakdown", "actionable" | HIGH |
| "decent support" | MEDIUM |
| "lower quality", "may be an entry" | LOW |
| "would not bid/engage", "too well tested", "risky", "I won't take this" | Exclude — no order |

### Supports and resistances

Copy full lists from "Supports are:" and "Resistances are:". Preserve (major) tags.

### Runner status

Find "I am still holding my X% long runner from [description]". Extract entry, date, P&L.

### Bull/bear case

Compress to control levels and target paths.

### Session rules

Max 2 fills. Win #1 → done. Lose #1 → one more. Lose #2 → done.

---

## WHAT IS EXTRACTED vs. DERIVED vs. NEVER FABRICATED

**Extracted directly:** Significant lows, flush targets, levels lists, quality language, caveats, runner status, bull/bear control levels, bias, chop zone.

**Derived mechanically:** Entry = sig_low + 5. Stop = flush - 4 or next support. T1/T2 from levels list. Risk = entry - stop. Conviction from language table.

**Never fabricated:** R:R ratios as "Mancini's". Confidence percentages. Acceptance durations. Regime codes. Dollar amounts. Any level not in the source.

---

## STANDARD OUTPUT FORMAT

Both Mancini and DP extractors produce this IDENTICAL format. OpenClaw reads one format.

```
=== TRADE PLAN: [source] | [date] ===

CONTEXT:
  source:    mancini
  bias:      [his lean ≤15 words]
  bull_ctrl: [level] — [reason ≤8 words]
  bear_trig: [level]
  chop:      [low]-[high] or none
  calendar:  [risk events today]
  runner:    [entry] → +[PL]pts | 10% trailing

---

ORDER 1 | [conviction] | [status]
  source:     mancini
  pot:        C
  ticker:     ES
  exec_as:    SPY
  direction:  LONG
  setup:      FB of [level] — "[his quality word]"
  why:        [≤20 words — what makes this significant]
  entry:      [price] LMT
  stop:       [price] — [source: flush-4 / next support]
  t1:         [price] (75%)
  t2:         [price] (15%)
  runner:     10% trail BE after T1
  risk:       [pts] pts
  caveat:     [his warning verbatim or "none"]
  kills:      [comma-separated kill conditions]
  activation: [for CONDITIONAL: what must happen first, or "immediate"]
  verify:     [what needs checking, or "none"]

ORDER 2 | [conviction] | [status]
  [same fields]

ORDER 3 | ...

---

WATCH:
  - [ticker] [level]: [reason — ≤15 words] (LOW)

---

SHORTS (reference only):
  - [level]: trigger below [bounce low] — [caveat]

---

LEVELS:
  S: **[major]** [minor] **[major]** [minor] ...
  R: **[major]** [minor] **[major]** [minor] ...

---

SCENARIOS:
  hold [level]: → [path]
  lose [level]: → [path]
```

### Notes on this format

- **Plain text, not markdown tables.** Easier for a local LLM to parse reliably.
- **Key: value pairs.** Predictable, greppable, no ambiguity.
- **Same field names as DP extractor.** `source`, `pot`, `ticker`, `exec_as`, `direction`, `entry`, `stop`, `t1`, `t2`, `risk`, `conviction`, `status`, `kills`, `activation`, `verify`.
- **ORDER blocks are self-contained.** Each one has everything needed to monitor and execute. No cross-referencing other sections.
- **The CONTEXT block is source-specific.** Mancini has chop zones and runners. DP has active positions and outlook. Both appear under CONTEXT with the same label pattern.
- **WATCH, SHORTS, LEVELS, SCENARIOS** are supplementary. Agent uses them for context but primary monitoring is ORDER blocks only.

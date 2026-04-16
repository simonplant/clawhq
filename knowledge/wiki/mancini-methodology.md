---
tags: [methodology, mancini, es-futures, intraday]
date: 2026-04-15
source-count: 2
confidence: established
last-verified: 2026-04-15
---

# Mancini Methodology

Adam Mancini's ES futures intraday trading system. Source: Futures Daily newsletter (tradecompanion.substack.com).

## Core Philosophy

- **React, never predict.** Wait for setups to trigger, then react.
- **Edge = Failed Breakdowns.** The one core setup. Everything else is commentary.
- **1-2 trades per day.** Entry windows: 7:30-8:30am and after 3pm ET. Avoid 11am-2pm (chop).
- **Level-to-level.** 90% of days don't trend. Take 75% off at first level, trail the rest.

## Three Setups

### Setup #1: Failed Breakdown (Core Edge)

ES flushes a significant low (trapping shorts), then recovers. Long the recovery.

**Significant low** = prior day's low, multi-hour low (rallied 20+ pts from), or shelf/cluster of lows.

**Entry requirement** — NEVER knife-catch. Must see ONE of:
- **Acceptance Type 1:** Price backtests significant low from below, sells off, returns (supply exhausted)
- **Acceptance Type 2:** Slow grind down without clean Type 1 (selling fails to move lower)
- **Non-Acceptance Protocol:** Price recovers 5pts above significant low, holds minutes (fast markets only)

**Danger Zone:** 0-5pts above recovered low = negative expectancy without acceptance.

See [[mancini-extraction-rules]] for how to extract setups from newsletters.

### Setup #2: Level Reclaim

Price loses significant level, then reclaims it. Used when price moves too fast for standard FB.

### Setup #3: Breakdown Short (Advanced)

80% of breakdowns trap. ~40% win rate, high R:R when it works. Short beneath lows of confirmation bounce. Not for beginners.

## Trade Management — 75/15/10 Rule

1. **75%** off at first level up
2. Move stop to several points under breakeven (not exact BE)
3. **15%** at second level
4. **10% runner** — trail via trailing stop

Never let the whole trade go red. If it trends, the runner captures it.

## Profit Protection Mode

After a win: hold runner, no other trades unless runner stops out AND new pre-planned setup triggers AND you risk only Trade 1 profits.

"One green trade, done" is the default.

## Market Cycle

Stairs Up → Elevator Down → Failed Breakdown → Short Squeeze. Repeats endlessly. Every point of red = 0.5-10 points of green — but ONLY after FB trigger.

## Trading Windows

| Time (ET) | Activity |
|-----------|----------|
| 7:30-8:30am | Primary entry window |
| 9:30-11am | Secondary entries |
| 11am-2pm | **Avoid** — chop zone |
| After 3pm | Secondary window |

## FOMC/CPI Day Rules

Size down dramatically. Expect double/triple traps. Failed Breakdowns mandatory (no direct bids). Level-to-level is survival.

## Related

- [[mancini-extraction-rules]] — How to parse newsletters into ORDER blocks
- [[dp-methodology]] — DP's complementary approach (stocks, not futures)
- [[pot-system]] — Pot C mirrors Mancini mechanically

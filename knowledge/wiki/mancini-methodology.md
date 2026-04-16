---
tags: [methodology, mancini, es-futures, intraday]
date: 2026-04-16
source-count: 2
confidence: established
last-verified: 2026-04-16
---

# Mancini Methodology

Adam Mancini's ES futures intraday trading system. Source: Futures Daily newsletter (tradecompanion.substack.com). Currently on June contract (ESM2026).

## Core Philosophy

- **React, never predict.** Wait for setups to trigger, then react. No opinions on direction.
- **Edge = Failed Breakdowns.** The one core setup. Everything else is commentary.
- **1-2 trades per day.** Entry windows: 7:30-8:30am and after 3pm ET. Avoid 11am-2pm (chop).
- **Level-to-level.** 90% of days don't trend. Take 75% off at first level, trail the rest.

## Three Setups

### Setup #1: Failed Breakdown (Core Edge)

ES flushes a significant low (trapping shorts), then recovers. Long the recovery.

**Significant low** = one of three things:
1. Prior day's low
2. Multi-hour low (rallied 20+ pts from it)
3. Shelf/cluster of lows (multiple touches)

**Entry requirement** — NEVER knife-catch. Must see ONE of:
- **Acceptance:** Price tries to sell at or above the significant low, returns to it (supply exhausted). Two forms — single V-test, or multi-touch shelf at the level.
- **Non-Acceptance Protocol (NAP):** Price recovers 5pts above significant low and holds for a few minutes. Used in fast markets where price rips through without pausing.

**Danger Zone:** 0-5pts above recovered low = where most FB losses happen. Need clear acceptance or wait for NAP (+5pts) before entry.

### Setup #2: Level Reclaim

Price loses significant level, then reclaims it. Used when price moves too fast for standard FB.

### Setup #3: Breakdown Short (Advanced)

80% of breakdowns are traps (that's why FBs work). The 20% that follow through are high R:R shorts. Short beneath the low of the confirmation bounce. Low win rate (~40%), requires skill.

## Trade Management — 75/15/10 Rule

1. **75%** off at first level up
2. Move stop to several points under breakeven (not exact BE — give room)
3. **15%** at second level
4. **10% runner** — trail via trailing stop

Never let the whole trade go red. If it trends, the runner captures it. The runner is a free lottery ticket for home-run days.

## Profit Protection Mode

After a win: hold runner, no other trades unless runner stops out AND new pre-planned setup triggers AND you risk only Trade 1 profits.

"One green trade, done" is the default. Two losses = done for the day.

## Market Cycle

Stairs Up -> Elevator Down -> Failed Breakdown -> Short Squeeze. Repeats endlessly. Every point of red = 0.5-10 points of green — but ONLY after the FB trigger. No knife catching.

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
- [[account-system]] — Account sizing and constraints

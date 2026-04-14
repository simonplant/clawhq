# MANCINI.md — Adam Mancini's Trading Methodology

> Reference doc for Clawdius — extract the "needle" from each newsletter without re-deriving the whole framework.
> Source: Adam Mancini's Futures Daily (tradecompanion.substack.com)
> Last updated: 2026-03-17 from March 17/18 newsletter

---

## Core Philosophy

- **React, never predict.** Markets always take the most complex, painful, trappy path. No professional predicts intraday direction. Wait for your setup to trigger, then react.
- **Trading is "simple but not easy."** The framework has 2-3 core setups. Mastery is in consistent execution, not complexity.
- **Edge = Failed Breakdowns.** That's it. Everything else is commentary.
- **One or two trades per day.** Entry windows: 7:30–8:30am and after 3pm ET. Avoid 11am–2pm (chop).

---

## Setup #1 — Failed Breakdown (Core Edge)

**What:** ES flushes a significant low (trapping shorts), then recovers that low. Long the recovery.

**Trigger conditions:**

1. **Significant Low** — one of:
   - Prior day's low
   - Multi-hour low (a low from which ES rallied 20+ points)
   - A shelf/cluster of lows

2. **Entry requirement** — NEVER knife-catch. Must see ONE of:
   - **Acceptance Type 1:** Price backtests the significant low from below, sells off, then returns to it (shows no supply at the low)
   - **Acceptance Type 2:** Price slow-grinds down to the significant low without clean acceptance Type 1 visible
   - **Non-Acceptance Protocol:** Price recovers the significant low by 5 points and holds above for a few minutes (triggers in high-volatility, fast markets). **The 5-point zone above the significant low is the danger zone** — don't enter without acceptance unless the non-acceptance protocol triggers.

3. The setup **remains valid** as long as the lowest low of the flush holds.

4. **If price is knifing (free-falling elevator down):** Do NOT attempt entry. Wait for the flush to complete and the Failed Breakdown trigger.

---

## Setup #2 — Level Reclaim

**What:** Price loses a significant level, then reclaims it. Long the reclaim.
- Used when price is moving too fast for a standard Failed Breakdown setup.
- Less common than Failed Breakdown, same underlying logic (trap then recover).

---

## Setup #3 — Breakdown Short (Advanced, Low Win Rate)

**What:** A significant support level fails and confirms.
- **80% of breakdowns trap** — this is why Mancini doesn't take them personally.
- Win rate: ~40%. High R/R when it works.
- **Not for beginners.** If 60% failure rate bothers you, skip this setup entirely.
- Entry: Short *beneath* the lows of the confirmation bounce at the level.

---

## Trade Management — The Law of Level-to-Level

**Rationale:** 90% of intraday moves do NOT produce trend days. Most moves go 1–3 levels then reverse. Hunt runners not home runs.

**System:**
1. **75%** out at first level up
2. Move stop to "several points under break-even" (not to breakeven exactly)
3. Lock in more at second level
4. Leave **10% runner** — trail via trailing stop

**Mandatory rules:**
- Never let the whole trade go back red
- Do not predict how far any move will go — let the levels decide
- If it does go trend day, the runner captures it

---

## Profit Protection Mode

After a winning trade:
1. Sit on runner. No other trades unless runner stops out below break-even.
2. Can take a second trade ONLY IF:
   - Runner stops out below break-even, AND
   - A new pre-planned setup emerges, AND
   - You risk only the profits from Trade 1 (never go day-negative)

"One green trade, done" is the default discipline.

---

## The Market Cycle (Elevator Down → Failed Breakdown → Short Squeeze)

ES doesn't sell in straight lines. Pattern repeats endlessly:

1. **Stairs Up** (slow grind rally)
2. **Elevator Down** (sharp, fast flush — can last minutes to a full day)
3. **Failed Breakdown** (flush the big low, trap shorts, recover)
4. **Short Squeeze** (violent rip, proportional to the size of the elevator down)

In downtrends: the squeeze is still violent but won't retrace 100% of the sell. Lower high.
In uptrends: full retrace and continuation.

**Corollary:** Every point of red is "put into a machine that spits out 0.5–10 points of green" — but ONLY after a Failed Breakdown trigger. Never before.

---

## Level Definitions

**Major vs. Minor:**
- Major levels are explicitly labeled "(major)" in the trade plan
- Minor levels are listed without the label
- Only bid major supports directly on controlled sells. On knife-down moves, wait for Failed Breakdowns of major lows.

**Bearish control:** Bears control until the shelf that caused the original breakdown recovers. This doesn't mean no bounces — the squeezes in bear control are the most violent precisely because the sells are fast and large.

---

## FOMC / CPI Day Rules

These are the hardest days of the year to trade. Mancini's rules:

1. **Size down dramatically** — or don't trade at all
2. **Expect double/triple traps** — the first move is usually a trap
3. **Failed Breakdowns mandatory** — don't buy/sell levels directly; wait for the trap
4. **Level-to-level is not optional on these days** — it's survival
5. **No predictions** — these days are essentially coin flips on direction. React only.

---

## Trading Window

| Time (ET) | Activity |
|-----------|----------|
| 7:30–8:30am | Primary entry window |
| 9:30–11am | Secondary entries if morning missed |
| 11am–2pm | Avoid — chop zone |
| 2pm–4pm | Secondary window for second trade only |
| After 3pm | Acceptable for second trade if first was profitable |

Newsletter published: typically 4pm ET the day before (so tomorrow's plan arrives tonight)

---

## Mancini's Daily Routine

1. Write plan night before (4pm post)
2. Wake up, check price vs plan
3. Wait for pre-planned setup at pre-planned zone
4. Enter on Failed Breakdown trigger only
5. Take 75% off first level, leave runner
6. **Done.** Hold runner, do nothing else unless runner stops below break-even

Total active trading time: ~15 minutes/day. The rest is waiting.

---

## How to Extract Tomorrow's Plan (Clawdius Workflow)

When pulling the Mancini brief, extract:

1. **Bull/Bear control level** — the shelf that must recover for bulls (e.g., "6819")
2. **Key long entries** (Failed Breakdown zones):
   - Level, the flush target (ideally tags what), and condition
   - Ordered by proximity to current price
3. **Key short backtests** (for completeness, Mancini doesn't take them)
4. **FOMC/catalyst notes** — any special rules for the session
5. **Mancini's current position** — any runners still held

**Trim the prose.** The newsletter is 3,000+ words; the actionable plan is ~20 levels + a few conditions.

---

## March 18 Plan (FOMC Day) — Live Example

**Bear control until:** 6815–6819 recovers

**Long entries (Failed Breakdowns):**

| Level | Condition | Note |
|-------|-----------|------|
| 6764 | Flush today's noon low, recover | Nearest entry; "much cleaner" than bidding 6770 direct |
| 6749 | Controlled sell only, bid direct or FB | Don't touch if knifing post-FOMC |
| 6716 | FB of 2am today's low (rallied 93pts from here) | Safer post-FOMC entry; bonus if tags 6703 |
| 6658 | FB of Sunday open low | Last ditch |
| 6635 | FB of last week's low, bonus tag 6623 | Deep support |

**Short backtests (higher risk):**
- 6815–6819, 6840, 6854, 6882

**Bull case:** Hold 6770/6764 (or quick trap below) → 6785 → 6802 → 6815–19 → 6854 → 6882 → 6980–85
**Bear trigger:** 6672 fails → real leg lower

**Mancini's position:** 10% long runner from Sunday 6689 Failed Breakdown. Green trade protection mode active.

**FOMC reminder:** Size down. Expect traps. Trade Failed Breakdowns only. Level-to-level mandatory.

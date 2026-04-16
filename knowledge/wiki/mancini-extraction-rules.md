---
tags: [extraction, mancini, order-format]
date: 2026-04-16
source-count: 2
confidence: established
last-verified: 2026-04-16
---

# Mancini Extraction Rules

How to parse Mancini's daily Substack newsletter into the daily brief and ORDER blocks. Two outputs: Quick Brief (compact summary for the daily brief) and Standard ORDER blocks (for execution and monitoring).

## Skip List

75% of every newsletter is boilerplate. Skip everything before "Trade Plan [Day]":
- Level-to-level approach explanation, Golden Rule, elevator/FB cycle, acceptance diagrams
- Mentor stories, housekeeping, contract roll notices, closing "no crystal balls" paragraph

## Extraction Steps

### 1. Locate Setups

In "In terms of lvls I'd bid" prose, find conditional chains:
- Identify significant low (anchor level)
- Classify: "flush and recover" → FB. "reclaim of" → RECLAIM. "one could bid" → DIRECT_BID
- Find flush target: "ideal if tags [X]", "perhaps to [X]"
- Check kill language: "would not bid" → exclude. "don't touch if knifing" → kill condition
- Note quality word verbatim

### 2. Entry (NAP Rule)

Non-Acceptance Protocol: `entry = significant_low + 5`. Clears the danger zone (0-5pts above recovered low = negative expectancy without acceptance).

### 3. Stop

If flush target stated → `stop = flush_target - 4`. If not → next support below significant low. Never invent buffer numbers.

### 4. Targets

`T1 = first level >= 8pts above entry` (prefer majors). `T2 = next level >= 8pts above T1`. Why >=8pts: level-to-level moves are 8-15pts.

### 5. Conviction Mapping

| His words | Conviction |
|-----------|-----------|
| "A+", "powerful", "clear significant low", "I get very interested" | HIGH |
| "quality Failed Breakdown", "actionable", "obviously actionable" | HIGH |
| "mildly interesting", "decent support", "one could bid" | MEDIUM |
| "lower quality", "may be an entry", "I personally won't be here" | LOW |
| "would not bid/engage", "too well tested", "risky" | Exclude |

### 6. Supports and Resistances

Copy full lists from "Supports are:" and "Resistances are:". Preserve (major) tags exactly as stated.

## Quick Brief Output

Ultra-compact summary for the daily brief. 2000 words max. Structure:
- Header: ES price, regime, mode, volatility
- TL;DR: one sentence
- SETUPS: code blocks only (Low/Flush/Accept/Entry/Stop/T1/T2/Run), max 3
- LEVELS: bullet lists (S: level | level | level / R: level | level)
- RUNNERS: one-liners (Entry -> Current (+PL) | Stop | Target)
- SCENARIOS: hold [level] -> path / lose [level] -> path
- EXECUTION: accept duration, avoid window, critical risk
- YESTERDAY: one-line outcome + learning

Word budget: TL;DR 50, SETUPS 1000, LEVELS 300, RUNNERS 200, SCENARIOS 200, EXECUTION 150, YESTERDAY 100.

## Standard ORDER Format Output

See [[standard-order-format]] for the unified format. Mancini-specific:
- `source: mancini`, `accounts: tos`, `ticker: ES`, `exec_as: /MES`
- Execute as /MES (Micro E-mini, $5/pt) on TOS. 10 /MES = 1 /ES.
- Risk per setup: stop distance x $5/pt x N contracts. 2 /MES = $150 risk on 15pt stop.
- Session rules: max 2 fills. Win #1 -> done. Lose #1 -> one more. Lose #2 -> done.

## What Is Extracted vs Derived vs Never Fabricated

**Extracted:** Significant lows, flush targets, levels lists, quality language, caveats, runner status, bull/bear triggers, bias.

**Derived:** Entry = sig_low + 5. Stop = flush - 4 or next support. T1/T2 from levels. Risk = entry - stop. Conviction from language table.

**Never fabricated:** R:R ratios as "Mancini's". Confidence percentages. Acceptance durations. Regime codes. Any level not in the source.

## Related

- [[mancini-methodology]] — The underlying trading system
- [[standard-order-format]] — Unified ORDER block spec
- [[dp-extraction-rules]] — DP's equivalent extraction contract
- [[account-system]] — Account sizing and constraints

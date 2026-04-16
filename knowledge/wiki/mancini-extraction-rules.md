---
tags: [extraction, mancini, v4-qr, order-format]
date: 2026-04-15
source-count: 2
confidence: established
last-verified: 2026-04-15
---

# Mancini Extraction Rules

How to parse Mancini's daily Substack newsletter into ORDER blocks. Two output modes: v4.0-QR Quick Brief (for daily brief) and Standard ORDER Format (for execution).

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

Non-Acceptance Protocol: `entry = significant_low + 5`. Clears the danger zone.

### 3. Stop

If flush target stated → `stop = flush_target - 4`. If not → next support below significant low. Never invent buffer numbers.

### 4. Targets

`T1 = first level ≥ 8pts above entry` (prefer majors). `T2 = next level ≥ 8pts above T1`. Why ≥8pts: level-to-level moves are 8-15pts.

### 5. Conviction Mapping

| His words | Conviction |
|-----------|-----------|
| "A+", "powerful", "clear significant low", "I get very interested" | HIGH |
| "quality Failed Breakdown", "actionable" | HIGH |
| "decent support" | MEDIUM |
| "lower quality", "may be an entry" | LOW |
| "would not bid/engage", "too well tested", "risky" | Exclude |

### 6. Supports and Resistances

Copy full lists from "Supports are:" and "Resistances are:". Preserve (major) tags.

## v4.0-QR Quick Brief Output

Ultra-compact, 2000 words max. Structure:
- Header: ES price, regime, mode, volatility
- TL;DR: one sentence
- SETUPS: code blocks only (Low/Flush/Accept/Entry/Stop/T1/T2/Run), max 3
- LEVELS: bullet lists (S: level * level * level / R: level * level)
- RUNNERS: one-liners (Entry → Current (+PL) | Stop | Target)
- SCENARIOS: hold [level] → path / lose [level] → path
- EXECUTION: accept duration, avoid window, critical risk
- YESTERDAY: one-line outcome + learning

Word budget: TL;DR 50, SETUPS 1000, LEVELS 300, RUNNERS 200, SCENARIOS 200, EXECUTION 150, YESTERDAY 100.

## Standard ORDER Format Output

See [[standard-order-format]] for the unified format. Mancini-specific:
- `source: mancini`, `accounts: tos,ira,tradier`, `ticker: ES`, `exec_as: SPY`
- ES → SPY conversion: 1 ES point ≈ $0.18 on SPY
- Session rules: max 2 fills. Win #1 → done. Lose #1 → one more. Lose #2 → done.

## What Is Extracted vs Derived vs Never Fabricated

**Extracted:** Significant lows, flush targets, levels lists, quality language, caveats, runner status, bull/bear triggers, bias.

**Derived:** Entry = sig_low + 5. Stop = flush - 4 or next support. T1/T2 from levels. Risk = entry - stop. Conviction from language table.

**Never fabricated:** R:R ratios as "Mancini's". Confidence percentages. Acceptance durations. Regime codes. Any level not in the source.

## Related

- [[mancini-methodology]] — The underlying trading system
- [[standard-order-format]] — Unified ORDER block spec
- [[dp-extraction-rules]] — DP's equivalent extraction contract
- [[pot-system]] — Account system and ES→SPY conversion

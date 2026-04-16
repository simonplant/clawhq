---
tags: [system, trading, edge, evolution]
date: 2026-04-16
source-count: 0
confidence: draft
last-verified: 2026-04-16
---

# Trading System

How Clawdius trades. Not a copy of Mancini or DP — a system that ingests their signals, measures what works, and evolves its own edge.

## What This System Does

Three jobs, in order of importance:

1. **Don't lose money.** Risk governor, position limits, drawdown halts. Non-negotiable.
2. **Surface the right trade at the right time.** Parse signals, detect confluence, rank by conviction + track record, deliver order-ready ideas.
3. **Get better every week.** Measure every signal source x setup type x conviction level. Cut what doesn't work. Double down on what does.

## Signal Sources

Four inputs, each with different reliability:

| Source | What | Priority | Conviction Source | Track Record Key |
|--------|------|----------|-------------------|------------------|
| **Mancini** | ES levels + Failed Breakdowns | 1 | His quality language → [[mancini-extraction-rules]] | `mancini-FB-{conviction}-ES` |
| **DP** | Stock watchlist + VTF alerts | 1 | His language → [[dp-extraction-rules]] | `dp-{trade_type}-{conviction}-{ticker}` |
| **Focus 25** | RS leaders, actionable cards | 2 | Mechanical (support/resistance proximity) | `focus25-{setup_type}-{conviction}-{ticker}` |
| **Scanner** | Algorithmic: MA pullbacks, RS, volume | 3 | TA-derived (RSI, distance to MA, volume) | `scanner-{screen}-{conviction}-{ticker}` |

Human-curated (Mancini, DP) outrank algorithmic (scanner) when they conflict. Focus 25 is primarily a confluence signal — it strengthens DP/scanner ideas, rarely stands alone.

### Confluence Rules

When sources align on the same ticker + direction + overlapping entry zone:
- **DP + Mancini aligned** → highest confidence. Rare (different instruments) but possible on SPY/QQQ.
- **DP + Focus 25 RS leader** → strong. DP names the idea, Focus 25 confirms relative strength.
- **Scanner + DP watchlist** → actionable. Scanner found the setup, DP already identified the name.
- **Single source only** → standard conviction from that source's own scoring.

When sources disagree on the same ticker → both ORDER blocks emitted, `divergence` flagged, Simon decides.

## The Edge (What Makes This System Different)

Mirroring Mancini or DP exactly is not an edge — it's a copy with latency. The edge comes from:

### 1. Synthesis Across Uncorrelated Sources

Mancini trades ES futures intraday. DP trades individual stocks on swing timeframes. Focus 25 measures relative strength across 25 names. These are uncorrelated views of the same market. When they align, the signal is stronger than any single source. No human can track all three simultaneously and cross-reference in real-time. Clawdius can.

### 2. Systematic Execution Discipline

Mancini's 75/15/10 rule and profit protection mode are simple but hard for humans to follow consistently. DP's "go flat" signals require immediate action across multiple accounts. The system enforces these mechanically — no FOMO, no revenge trading, no skipping the stop.

### 3. Track-Record-Weighted Conviction

Static conviction mapping (HIGH/MEDIUM/LOW from language) is the starting point. Over time, track-record data reveals which source x setup x conviction combinations actually make money. The system adjusts sizing and ranking based on what works, not what sounds confident.

### 4. Timing Intelligence

The gap between DP's AM Call level and Kira's actual entry is data. The gap between Mancini's published setup and the time it triggers is data. Over time, patterns emerge: which setups trigger in the first 30 minutes? Which never trigger? Which work better in the afternoon window?

## Feedback Loops

### Daily: EOD Review → Tomorrow's Brief

After every session, `eod-review` scores each ORDER block via `track-record score`. This creates a growing dataset: source, setup type, conviction, ticker, outcome (WIN/LOSS/SCRATCH), P&L.

The next morning, `premarket-brief` reads `track-record stats` and `track-record best/worst` to weight today's ideas. A Mancini FB-HIGH setup with a 70% win rate over 20 trades gets more weight than a scanner-RS-MEDIUM setup with 40% over 10 trades.

### Weekly: Pattern Review

Every Friday (or weekend), review the rolling 30-day track record:
- `track-record best --days 30` → which combos are printing money?
- `track-record worst --days 30` → which combos are bleeding?
- Cross-reference worst with conviction levels — are we sizing HIGH on a low-accuracy setup?

**Action thresholds:**
- Win rate < 35% over 10+ trades → flag as CUT candidate. Review whether the extraction is wrong (fixable) or the setup genuinely doesn't work (cut it).
- Win rate > 65% over 10+ trades → flag for UPSIZE. Consider full-size LIMIT instead of half-size.
- P&L positive but win rate < 50% → the R:R is good but entries are loose. Tighten entry criteria, don't cut the setup.
- P&L negative and win rate > 50% → winning often but losing big. Stop discipline problem — review stop derivation.

### Monthly: System Evolution

Review the full track record and make structural changes:
- Which source contributes most to P&L? (May shift priority ranking)
- Is scanner adding value or just noise? (If < 40% accuracy after 30 days, pause scanner ORDERs and demote to WATCH-only)
- Are Focus 25 confluence signals actually improving win rate vs single-source? (Measure with/without confluence)
- AM Call level vs actual VTF execution gap — is it widening? (If AM Call levels never get hit, stop generating ORDER blocks from them — oh wait, we already don't. Validate that dp-parse is correctly producing WATCHLIST not ORDERs from AM Call.)

## Evolution Phases

### Phase 1: Mirror + Measure (current)

- Parse all sources mechanically into ORDER blocks
- Clawdius is alert-only (no autonomous execution)
- Track every signal's outcome via `track-record`
- Build the dataset: which signals work, which don't
- Simon executes all trades on TOS and Fidelity
- **Goal:** 30+ scored trades per source before making any system changes

### Phase 2: Weighted Conviction

- Track-record stats feed into premarket-brief ranking
- Conviction becomes a function of (source language + historical accuracy), not just source language
- Scanner ideas with proven track record can graduate from WATCH to ORDER
- Ideas from consistently wrong combos get auto-downgraded
- **Gate:** 30+ scored trades per source x setup combo with meaningful sample

### Phase 3: Autonomous Tradier

- Risk governor spec complete and battle-tested
- Clawdius executes on Tradier account without Simon's approval
- Only for HIGH conviction + CONFIRMED signals with positive track record
- Shadow-mode first: log what would have been executed, compare to actual outcomes
- **Gate:** Risk governor passes full audit. Shadow mode matches or beats Simon's timing for 30+ trades. Simon explicitly approves.

### Phase 4: Clawdius's Own Ideas

- Scanner setups with strong track record become first-class signals (not just priority 3)
- Clawdius develops its own entry criteria based on what the data shows works
- New screens tested in shadow mode before going live
- **Gate:** Scanner-originated ideas must show > 50% win rate over 50+ trades in shadow mode

## What This System Does NOT Do

- **Predict direction.** Mancini's core lesson: react, never predict. The system waits for setups to trigger at planned zones.
- **Chase.** If a level is missed, it's missed. No market orders to catch up.
- **Override the risk governor.** Every trade passes `risk_governor.py check`. If blocked, it's blocked. Log the block, don't circumvent.
- **Trade without a plan.** No ideas generated during market hours that weren't in the morning brief or triggered by VTF alerts.
- **Hold opinions.** The system doesn't care if ES goes up or down. It cares whether setups trigger at planned levels.

## Measuring Success

The system is working if:
- Total P&L is positive over rolling 30 days (across all sources)
- Win rate by source x setup is stable or improving
- Track record has no gaps (every ORDER scored at EOD)
- Risk governor blocks are rare (signals are well-formed before reaching the governor)
- Simon reports fewer missed opportunities and fewer FOMO trades

The system is failing if:
- A source consistently generates losing signals (track-record worst shows chronic underperformance)
- Extraction is producing ORDERs that don't match what the source actually said (fabrication/drift)
- Alert fatigue — too many LOW conviction signals reaching Simon
- Track-record gaps — ORDERs not being scored, data not compounding

## Related

- [[mancini-methodology]] — Source 1 system
- [[dp-methodology]] — Source 2 system (three signal layers)
- [[mancini-extraction-rules]] — Newsletter → ORDER blocks
- [[dp-extraction-rules]] — AM Call + VTF → ORDER blocks
- [[account-system]] — Account sizing and constraints
- [[standard-order-format]] — Unified ORDER block spec

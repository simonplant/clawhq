---
tags: [system, pots, risk, paper-trading]
date: 2026-04-15
source-count: 3
confidence: established
last-verified: 2026-04-15
---

# Pot System

Three-pot paper trading experiment. $100K split equally to compare strategies against each other and SPY.

## Allocation

| Pot | Name | Capital | Strategy | Signal Source |
|-----|------|---------|----------|---------------|
| A | Clawdius System | $33,333 | Discretionary (TA + all sources) | [[dp-methodology]] + [[mancini-methodology]] + swing-scanner |
| B | Mirror DP | $33,333 | Mechanical mirror of DP alerts | [[dp-extraction-rules]] VTF parsing |
| C | Mirror Mancini | $33,333 | Mechanical mirror of Mancini levels | [[mancini-extraction-rules]] level monitoring |

## Constraints (per pot)

- **Max position:** 15% of pot (~$5K)
- **Max exposure:** 60% of pot (~$20K)
- **Max risk per trade:** 1% of pot (~$333)
- **Max concurrent positions:** 3-4
- **Halt drawdown:** 10% from allocation → review before resuming

## Pot B (Mirror DP) — Rules

- **Planned trades:** full size (up to 15%)
- **Scalps:** half size
- **Follow DP exactly:** when he enters, we enter. When he exits, we exit.
- **FLAT means FLAT:** close all Pot B positions for that ticker
- Every trade passes through risk_governor.py before execution

## Pot C (Mirror Mancini) — Rules

- **ES → SPY conversion:** 1 ES point ≈ $0.18 on SPY
- **Monitor via:** `tradier quote ES=F`. **Execute as:** SPY
- **Follow Mancini protocol:** T1 scale (75%), T2 scale (15%), runner (10%)
- **Session rules:** max 2 fills. Win #1 → done. Lose #1 → one more. Lose #2 → done.
- **Profit Protection Mode:** after win, hold runner only. No new trades unless runner stops out + new FB triggers.

## Pot A (Clawdius) — Rules

- Discretionary — uses all sources + own TA (ta tool)
- Document thesis in trade notes
- swing-scanner feeds candidates
- Tracked independently of B and C

## DP vs Mancini: Why Two Pots

| Dimension | Pot B (DP) | Pot C (Mancini) |
|-----------|-----------|-----------------|
| Instrument | Individual stocks + QQQ/SPY | ES futures (executed as SPY) |
| Timeframe | Day trade + swing (overnight) | Intraday ES |
| Entry style | Theme + relative strength + MAs | Failed Breakdowns + flush zones |
| Key levels | 8d, 10d, 21d, 200d MAs | Price levels from newsletter |
| Sizing | Conviction-based, 1% risk | Protocol-based (75/15/10) |
| Delivery | Live VTF alerts + AM Call | Daily Substack post |

When both sources align on a level → higher confidence. When they disagree → each pot follows its own source mechanically.

## Performance Tracking

- Daily: `trade-journal mark` (mark-to-market), `trade-journal compare` (pot vs pot vs SPY)
- Reconciliation: `trade-journal reconcile` (journal matches Tradier?)
- EOD review categorizes each pot's performance

## Related

- [[dp-methodology]] — Pot B's source system
- [[dp-conviction-scoring]] — How DP language maps to conviction and sizing
- [[mancini-methodology]] — Pot C's source system
- [[standard-order-format]] — ORDER blocks route to pots via `pot` field

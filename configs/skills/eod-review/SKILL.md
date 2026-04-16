---
name: eod-review
description: "End-of-day trading review per TRADING_SOP.md Phase 6 (REVIEW). Marks positions to market, compares pots vs SPY, reconciles journal vs Tradier, reviews level accuracy, and produces the EOD report. Feeds lessons into tomorrow's RESEARCH phase. Cron at 13:15 PT weekdays (4:15 PM ET, after market close)."
---

# eod-review — End-of-Day Trading Review

Phase 6 (REVIEW) of the daily trading cycle. After market close, assess what happened: mark positions, compare strategies, check level accuracy, and feed lessons forward.

Read `references/TRADING_SOP.md` Phase 6 for the full specification.

## Schedule

- **Cron:** 1:15 PM PT weekdays (`15 13 * * 1-5`) = 4:15 PM ET, after market close
- **Direct:** Simon asks "EOD review", "how'd we do today", "end of day"

## Procedure

### 1. Pre-check

Run `market-calendar today`. If not a market day, skip with "No market session today."

### 2. Mark to Market

```
trade-journal mark
```
Update all open position prices to closing values.

### 3. Compare Pots

```
trade-journal compare
```
Pot A vs Pot B vs Pot C vs SPY benchmark. This is the core experiment metric — which strategy is winning?

### 4. Reconcile

```
trade-journal reconcile
```
Verify the paper journal matches actual Tradier positions. Flag any mismatches (phantom trades, missed fills, stale positions).

### 5. Risk Status

```
risk_governor.py status
```
Current risk utilization: exposure, drawdown, daily P&L, pot halts.

### 6. Level Review

Read today's trading brief (`memory/trading-YYYY-MM-DD.md`). For each ORDER block and key level:

Fetch closing prices:
```
quote SPY QQQ ES=F [+ any symbols from ORDER blocks]
```

Categorize each level:
- **TRIGGERED** — price came within 0.5% of the level
- **NEAR** — price came within 2% of the level
- **WATCH** — level not approached today

For each triggered level: did the setup work? Did the predicted direction play out? Was acceptance confirmed?

### 7. Signal Accuracy

Review signals delivered to Simon today:
- Premarket brief trade ideas: which were correct?
- Heartbeat alerts: were they timely and accurate?
- DP VTF signals (if any): how did Pot B trades perform?
- Mancini setups (if any): how did Pot C trades perform?

### 8. Journal Summary

```
journal summary
```
Count: signals received, risk checks run, orders placed, fills, governor blocks. This is the audit trail.

### 9. Produce EOD Report

One message:

```
=== EOD Review — YYYY-MM-DD ===

MARKET SUMMARY
[ES close, % change, session character (trend/chop/reversal)]
[Key macro drivers of the day]

POT PERFORMANCE
Pot A (Clawdius):  $X P&L (+Y%)  [positions: ...]
Pot B (Mirror DP): $X P&L (+Y%)  [positions: ...]
Pot C (Mancini):   $X P&L (+Y%)  [positions: ...]
SPY benchmark:     +Z%

LEVEL ACCURACY
[For each ORDER block: TRIGGERED/NEAR/WATCH, outcome if triggered]
Mancini: [N] levels in play, [M] triggered, [accuracy summary]
DP: [N] levels, [M] triggered

SIGNAL REVIEW
[Brief: how many ideas were correct? What was the best/worst call?]

TOMORROW'S SETUP
[Mancini pull running at 2:30 PM — key carryforward levels/positions]
[Open positions carrying overnight with current stops]
[Any strategy halt flags (pot down >10%)]
```

### 10. Feed Forward

- **Open positions** carry into tomorrow's RESEARCH phase
- **Lessons** → append to `memory/trading-YYYY-MM-DD.md` notes section
- **Strategy concerns** → if a pot is consistently losing, flag for halt review:
  - Pot down >10% from allocation → recommend `trade-journal halt <pot> "drawdown review"`
  - 3+ consecutive losing days → flag pattern
- **Mancini pull** at 2:30 PM PT begins tomorrow's RESEARCH phase automatically
- Write EOD data to `memory/trading-YYYY-MM-DD-eod.md` for the portfolio review cron

## Boundaries

- **Read-only for positions.** This skill reviews and reports. It does NOT place orders, close positions, or modify the portfolio. Exception: it runs `trade-journal mark` which updates prices (not positions).
- **No trade recommendations.** The review is backward-looking. Forward-looking ideas are tomorrow's premarket-brief.
- **No reconciliation fixes.** If `trade-journal reconcile` finds mismatches, report them to Simon. Don't auto-fix.

## References

- `references/TRADING_SOP.md` — Phase 6 (REVIEW), EOD report format
- `references/TRADING_PIPELINE.md` — EOD Reconciliation section
- `references/STANDARD_ORDER_FORMAT.md` — ORDER block format for level review

## Requires

- `trade-journal` workspace tool (mark, compare, reconcile, summary)
- `quote` workspace tool (closing prices)
- `risk_governor.py` (risk status)
- `journal.py` (journal summary)
- `market-calendar` (market day check)

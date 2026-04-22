# Daily Brief - 2026-04-21

Assorted narrative and scan results precede the orders section.

Regime: CHOP. SPY RSI 71.8 (overbought). No broad conviction.

## Orders

ORDER 1 | HIGH | ACTIVE
  source:       mancini
  accounts:     tos
  ticker:       ES
  exec_as:      /MES
  direction:    LONG
  setup:        Failed Breakdown A+
  why:          A+ quality Failed Breakdown at 7085
  entry:        7090 LMT
  stop:         7078 — flush-4
  t1:           7105 (75%) — stated
  t2:           7120 (15%) — next major R
  runner:       10% trail BE after T1
  risk:         $12 | 2 /MES | $120
  confirmation: CONFIRMED
  confluence:   DP+MANCINI
  caveat:       none
  kills:        lose_7078
  activation:   immediate
  verify:       none

ORDER 2 | MEDIUM | CONDITIONAL
  source:       dp
  accounts:     tos,ira
  ticker:       META
  exec_as:      META
  direction:    LONG
  setup:        200d MA pullback — "I'm a buyer at X"
  why:          DP named 200d level, quality name
  entry:        681 LMT
  stop:         667 — MA-2%
  t1:           695 — stated
  t2:           707 — estimated
  runner:       10% trail BE after T1
  risk:         $14 | 50 shares | $700
  confirmation: PENDING_TA
  confluence:   none
  caveat:       overbought broader market
  kills:        dp_flat
  activation:   pullback_to_200d
  verify:       none

ORDER 3 | LOW | BLOCKED
  source:       scanner
  accounts:     tos
  ticker:       INVALIDTICKER
  exec_as:      INVALID
  direction:    LONG
  setup:        missing_required_field
  why:          this should be kept even though LOW
  entry:        100 LMT
  stop:         not-a-number
  t1:           105 — stated
  t2:           110 — stated
  runner:       10% trail BE after T1
  risk:         $5 | 10 | $50
  confirmation: PENDING_TA
  confluence:   none
  caveat:       none
  kills:        none
  activation:   immediate
  verify:       none

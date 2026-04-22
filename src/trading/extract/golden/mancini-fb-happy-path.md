# Some preceding narrative that should be ignored

Mancini long from 7085 backtest / 7120 Failed Breakdown — "ride runner" all week. Targets 7186, 7194, 7217. 7147-53 support.

## Orders

ORDER 1 | HIGH | ACTIVE
  source:       mancini
  accounts:     tos
  ticker:       ES
  exec_as:      /MES
  direction:    LONG
  setup:        Failed Breakdown — "quality Failed Breakdown"
  why:          clean reclaim of 7085 support, NAP entry above sig low
  entry:        7090 LMT
  stop:         7078 — flush-4
  t1:           7105 (75%) — next R
  t2:           7120 (15%) — next major R
  runner:       10% trail BE after T1
  risk:         $12/pt | 2 /MES | $120
  confirmation: CONFIRMED
  confluence:   none
  caveat:       none
  kills:        lose_7078
  activation:   immediate
  verify:       none

---

Trailing text after the order block that should not be parsed as part of it.
